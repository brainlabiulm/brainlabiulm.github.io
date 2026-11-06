import { readdirSync, mkdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";

const root = process.cwd();
const sourceDir = resolve(root, "private");
const outputDir = resolve(root, "docs");
const staticryptCli = resolve(root, "node_modules", "staticrypt", "cli", "index.js");
const configPath = resolve(root, ".staticrypt.json");
const passwordTemplate = resolve(root, "password-template.html");

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function hiddenInput(prompt) {
  return new Promise((resolveInput, rejectInput) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      rejectInput(new Error("Avvia `npm run build` da un terminale interattivo."));
      return;
    }

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          rejectInput(new Error("Generazione annullata."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolveInput(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          stdout.write("•");
        }
      }
    };

    stdin.on("data", onData);
  });
}

if (!statSync(resolve(root, "package.json")).isFile()) {
  throw new Error("Esegui questo script dalla cartella principale del sito.");
}

let files;
try {
  files = collectFiles(sourceDir);
} catch {
  throw new Error("Cartella `private` mancante. Crea `private/index.html` prima di generare il sito.");
}

const htmlFiles = files.filter((file) => file.toLowerCase().endsWith(".html"));
const assetFiles = files.filter((file) => /\.(css|js|mjs)$/i.test(file));
const skippedFiles = files.filter((file) => !/\.(html|css|js|mjs)$/i.test(file));

if (!htmlFiles.some((file) => relative(sourceDir, file).toLowerCase() === "index.html")) {
  throw new Error("La cartella `private` deve contenere `index.html`.");
}

const password = await hiddenInput("Password condivisa: ");
if (password.length < 16) {
  throw new Error("Usa una password lunga almeno 16 caratteri, unica e non riutilizzata.");
}
const confirmation = await hiddenInput("Ripeti la password: ");
if (password !== confirmation) throw new Error("Le password non corrispondono.");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
copyFileSync(resolve(root, ".nojekyll"), join(outputDir, ".nojekyll"));

for (const file of assetFiles) {
  const relativePath = relative(sourceDir, file);
  const target = join(outputDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  stdout.write(`Copia asset pubblico: ${relativePath}\n`);
}

if (skippedFiles.length) {
  stdout.write("\nFile ignorati (non HTML/CSS/JS):\n");
  for (const file of skippedFiles) stdout.write(`  ${relative(sourceDir, file)}\n`);
}

for (const file of htmlFiles) {
  const relativePath = relative(sourceDir, file);
  const targetDir = join(outputDir, dirname(relativePath));
  mkdirSync(targetDir, { recursive: true });
  stdout.write(`Cifratura: ${relativePath}\n`);

  const result = spawnSync(
    process.execPath,
    [
      staticryptCli,
      file,
      "--directory",
      targetDir,
      "--config",
      configPath,
      "--template",
      passwordTemplate,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, STATICRYPT_PASSWORD: password },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`StatiCrypt non ha cifrato ${relativePath}.`);
}

stdout.write(`\nSito cifrato pronto in ${relative(root, outputDir)}\\.\n`);
stdout.write("Controlla che in `docs` ci siano solo pagine cifrate e poi pubblica quella cartella.\n");
