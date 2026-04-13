import fs from "fs";
import path from "path";

const file = path.join(__dirname, "..", "build-number.json");
const data = JSON.parse(fs.readFileSync(file, "utf-8"));
data.build++;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

// Keep package.json version and buildVersion in sync
const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const [major, minor] = pkg.version.split(".");
pkg.version = `${major}.${minor}.${data.build}`;
pkg.build.buildVersion = String(data.build);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Build ${data.build}`);
