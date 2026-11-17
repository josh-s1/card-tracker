"""Trusted local-only single-process sandbox launcher. No target imports here."""
import ctypes
import os
import resource
import subprocess
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])


class Comparison(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint), ("op", ctypes.c_uint),
        ("mask", ctypes.c_uint64), ("value", ctypes.c_uint64),
    ]


lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add_array.argtypes = [
    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int,
    ctypes.c_uint, ctypes.POINTER(Comparison),
]
lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7FFF0000)  # Default allow, deny process creation.
assert ctx
for name in [b"fork", b"vfork", b"unshare", b"setns"]:
    assert lib.seccomp_rule_add_array(
        ctx, 0x00050001, lib.seccomp_syscall_resolve_name(name), 0, None,
    ) == 0
# glibc falls back to inspectable clone flags; only shared-memory threads allowed.
assert lib.seccomp_rule_add_array(
    ctx, 0x00050026, lib.seccomp_syscall_resolve_name(b"clone3"), 0, None,
) == 0
condition = Comparison(0, 7, 0x00010000, 0)  # CLONE_THREAD absent.
assert lib.seccomp_rule_add_array(
    ctx, 0x00050001, lib.seccomp_syscall_resolve_name(b"clone"),
    1, ctypes.byref(condition),
) == 0
fd = os.memfd_create("single-process-test-policy", flags=0)
assert lib.seccomp_export_bpf(ctx, fd) == 0
lib.seccomp_release(ctx)
os.lseek(fd, 0, 0)

# Avoid tsx/esbuild child processes: transpile TypeScript in the single sandboxed
# Node process. All target/dependency code remains inside the same resource bounds.
bootstrap = r"""
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('/repo/node_modules/typescript');
const probe = require('node:child_process').spawnSync(process.execPath, ['-e','process.exit(0)']);
if (!probe.error || probe.error.code !== 'EPERM') throw new Error('Process confinement failed');
try {
  fs.writeFileSync('/repo/should-not-be-writable', 'no');
  throw new Error('Read-only source confinement failed');
} catch (error) {
  if (!['EROFS','EACCES'].includes(error.code)) throw error;
}
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith('@shared/')) name = '/repo/shared/' + name.slice(8);
  if (name.startsWith('@/')) name = '/repo/client/src/' + name.slice(2);
  return originalResolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts','.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, {
      fileName:filename,
      compilerOptions:{
        module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
        esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX
      },
      reportDiagnostics:true
    });
    const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
    if(errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
      getCanonicalFileName:f=>f,getCurrentDirectory:()=>'/repo',getNewLine:()=>'\n'
    }));
    mod._compile(result.outputText,filename);
  };
}
if (process.argv[1] === 'check') {
  const config=ts.readConfigFile('/repo/tsconfig.json',ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'/repo',{
    incremental:false,noEmit:true
  });
  const program=ts.createProgram(parsed.fileNames,parsed.options);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
      getCanonicalFileName:f=>f,getCurrentDirectory:()=>'/repo',getNewLine:()=>'\n'
    }));
    process.exitCode=1;
  } else console.log('TypeScript check passed (no emit, no incremental writes).');
} else {
  require('/repo/server/auth.test.ts');
  require('/repo/server/data-lifecycle.test.ts');
}
"""

command = [
    "/usr/bin/timeout", "--kill-after=2s", "45s",
    "/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session",
    "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64", "--proc", "/proc",
    "--remount-ro", "/proc", "--dev", "/dev", "--remount-ro", "/dev",
    "--size", str(16 * 1024 * 1024), "--tmpfs", "/scratch",
    "--dir", "/scratch/home", "--dir", "/scratch/tmp",
    "--symlink", "/scratch/tmp", "/tmp",
    "--dir", "/repo",
]
for entry in ["server", "client", "shared", "node_modules", "tsconfig.json", "package.json", "vite.config.ts"]:
    command += ["--ro-bind", f"{ROOT}/{entry}", f"/repo/{entry}"]
for key, value in {
    "PATH": "/usr/local/bin:/usr/bin", "HOME": "/scratch/home",
    "TMPDIR": "/scratch/tmp", "NODE_ENV": "test",
    "TURSO_DATABASE_URL": "file:/scratch/dummy.db",
    "APP_PIN": "dummy-test-password", "UV_THREADPOOL_SIZE": "2",
}.items():
    command += ["--setenv", key, value]
command += [
    "--remount-ro", "/", "--chdir", "/repo", "--seccomp", str(fd),
    "/usr/bin/prlimit", "--nproc=32:32", "--",
    "/usr/local/bin/node", "--max-old-space-size=512",
    "--wasm-enforce-bounds-checks", "--wasm-max-mem-pages=1024",
    "-e", bootstrap, sys.argv[1] if len(sys.argv) > 1 else "test",
]


def limits():
    for kind, value in [
        (resource.RLIMIT_CPU, 30), (resource.RLIMIT_AS, 2048 * 1024 * 1024),
        (resource.RLIMIT_NOFILE, 128),
        (resource.RLIMIT_FSIZE, 1024 * 1024), (resource.RLIMIT_CORE, 0),
    ]:
        resource.setrlimit(kind, (value, value))


try:
    result = subprocess.run(
        command, env={}, pass_fds=(fd,), preexec_fn=limits,
        stdin=subprocess.DEVNULL, timeout=50,
    )
    sys.exit(result.returncode)
finally:
    os.close(fd)
