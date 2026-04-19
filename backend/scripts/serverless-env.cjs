const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(__dirname, "..", ".env");

function parseDotEnv(text) {
  const parsed = {};

  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const sep = line.indexOf("=");
    if (sep <= 0) {
      continue;
    }

    const key = line.slice(0, sep).trim();
    const valueRaw = line.slice(sep + 1).trim();

    const value = valueRaw
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/^'([\s\S]*)'$/, "$1");

    parsed[key] = value;
  }

  return parsed;
}

if (!fs.existsSync(ENV_PATH)) {
  module.exports = {};
} else {
  const content = fs.readFileSync(ENV_PATH, "utf8");
  module.exports = parseDotEnv(content);
}
