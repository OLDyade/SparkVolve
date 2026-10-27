import { spawn } from 'node:child_process';

// Python exposes POSIX openat through os.open(dir_fd=...). Node's stable fs API has
// no descriptor-relative traversal. One implementation handles bytes and inventories.
// -I -S prevents working-directory, PYTHONPATH and user/site initialization code.
const program = String.raw`
import os, sys, stat, hashlib, json, errno
def report_error(kind, error, traceback):
    print(json.dumps({"type":kind.__name__, "message":str(error), "code":errno.errorcode.get(error.errno) if isinstance(error,OSError) else None}),file=sys.stderr)
sys.excepthook = report_error
if os.open not in os.supports_dir_fd or os.listdir not in os.supports_fd:
    raise RuntimeError("Evidence access requires Python 3 descriptor-relative POSIX file APIs")
for flag in ("O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK"):
    if not hasattr(os, flag):
        raise RuntimeError("Evidence access requires " + flag)

def pieces(value):
    parts = value.split("/")
    if not value or "\\" in value or any(p in ("", ".", "..") for p in parts):
        raise ValueError("Invalid relative evidence path")
    return parts

def regular(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Evidence leaf must be a regular file")
    return info

def file_hash(fd):
    result = hashlib.sha256()
    while True:
        data = os.read(fd, 1024 * 1024)
        if not data:
            return result.hexdigest()
        result.update(data)

def inventory(fd, relative, result):
    info = os.fstat(fd)
    if stat.S_ISREG(info.st_mode):
        result.append({"path": relative, "hash": file_hash(fd), "executable": bool(info.st_mode & 0o111)})
    elif stat.S_ISDIR(info.st_mode):
        # Match JavaScript UTF-16 ordering in existing canonical artifact identities.
        for name in sorted(os.listdir(fd), key=lambda text: text.encode("utf-16-be", "surrogatepass")):
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                inventory(child, relative + "/" + name if relative else name, result)
            finally:
                os.close(child)
    else:
        raise ValueError("Evidence inventory accepts only regular files and directories")

operation = sys.argv[1]
if operation == "capabilities":
    print(json.dumps({"python": sys.version.split()[0], "descriptorRelative": True, "noFollow": True}))
else:
    root = os.open(sys.argv[2], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if operation == "inventory":
            result = []
            inventory(root, "", result)
            print(json.dumps(result, ensure_ascii=True))
        elif operation == "read":
            if not stat.S_ISDIR(os.fstat(root).st_mode):
                raise ValueError("Evidence root must be a directory")
            parts = pieces(sys.argv[3])
            current = os.dup(root)
            try:
                for index, name in enumerate(parts):
                    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                    if index != len(parts) - 1:
                        flags |= os.O_DIRECTORY
                    child = os.open(name, flags, dir_fd=current)
                    os.close(current)
                    current = child
                regular(current)
                while True:
                    data = os.read(current, 1024 * 1024)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
            finally:
                os.close(current)
        else:
            raise ValueError("Unknown evidence reader operation")
    finally:
        os.close(root)
`;

async function read(operation: string, ...args: string[]): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-S', '-c', program, operation, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.once('error', (error) =>
      reject(new Error('Python 3 POSIX evidence reader could not start', { cause: error })),
    );
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(output));
        return;
      }
      const stderr = Buffer.concat(errors).toString();
      const error: NodeJS.ErrnoException = new Error(
        `Authorized evidence reader failed (${code ?? signal}): ${stderr}`,
      );
      try {
        const detail = JSON.parse(stderr) as { code?: unknown };
        if (typeof detail.code === 'string') error.code = detail.code;
      } catch {
        /* Preserve startup, syntax or signal diagnostics without inventing an errno. */
      }
      reject(error);
    });
  });
}

/** Root is a host-owned authorization boundary, never a path supplied by a tool caller. */
export async function readAuthorizedFile(root: string, relative: string): Promise<Buffer> {
  return await read('read', root, relative);
}

/** Traversal and hashing share open directory descriptors; no path-based second read. */
export async function authorizedInventory(
  root: string,
): Promise<Array<{ path: string; hash: string; executable: boolean }>> {
  return JSON.parse((await read('inventory', root)).toString());
}

export async function fileReaderCapabilities(): Promise<{
  python: string;
  descriptorRelative: true;
  noFollow: true;
}> {
  return JSON.parse((await read('capabilities')).toString());
}
