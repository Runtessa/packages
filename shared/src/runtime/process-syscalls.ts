// Linux classic BPF: deny extra processes and inspecting/entering other processes.
// clone3 returns ENOSYS so libc can use clone for Node's required runtime threads.
export const processSyscallFilter = (): Buffer => {
  const architectures: Record<string, { audit: number; clone: number; blocked: number[] }> = {
    x64: { audit: 0xc000003e, clone: 56, blocked: [57, 58, 101, 165, 166, 272, 308, 310, 311, 438] },
    arm64: { audit: 0xc00000b7, clone: 220, blocked: [39, 40, 97, 117, 268, 270, 271, 438] },
  };
  const architecture = architectures[process.arch];
  if (!architecture) throw new Error('Unsupported restricted runtime architecture');
  const instructions: Array<[number, number, number, number]> = [
    [0x20, 0, 0, 4], [0x15, 1, 0, architecture.audit], [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0], [0x15, 0, 1, 435], [0x06, 0, 0, 0x00050000 | 38],
  ];
  for (const syscall of architecture.blocked) instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050000 | 1]);
  instructions.push([0x15, 0, 4, architecture.clone], [0x20, 0, 0, 16], [0x54, 0, 0, 0x00010000],
    [0x15, 0, 1, 0], [0x06, 0, 0, 0x00050000 | 1], [0x06, 0, 0, 0x7fff0000]);
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, k], index) => {
    buffer.writeUInt16LE(code, index * 8); buffer[index * 8 + 2] = jt;
    buffer[index * 8 + 3] = jf; buffer.writeUInt32LE(k, index * 8 + 4);
  });
  return buffer;
};
