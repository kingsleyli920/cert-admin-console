const [major, minor] = process.versions.node.split('.').map(Number);
const ok = major > 22 || (major === 22 && minor >= 13);

if (!ok) {
  console.error(
    `Node ${process.versions.node} is not supported. This project needs Node >= 22.13 (see .nvmrc).`,
  );
  process.exit(1);
}
