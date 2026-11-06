import {
  readdirSync,
  mkdirSync,
  rmSync,
  statSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";

const root = process.cwd();
const sourceDir = resolve(root, "private");
const outputDir = resolve(root, "docs");
const staticryptCli = resolve(root, "node_modules", "staticrypt", "cli", "index.js");
const configPath = resolve(root, ".staticrypt.json");
const passwordTemplate = resolve(root, "password-template.html");
const sharedCss = resolve(root, "assets", "site.css");

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") files.push(...collectFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function inlineLocalScripts(html, htmlFile) {
  let count = 0;
  const transformed = html.replace(/<script\b([^>]*)>\s*<\/script\s*>/gi, (tag, attributes) => {
    const srcMatch = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    if (!srcMatch) return tag;

    const src = srcMatch[2];
    if (/^(?:https?:|\/\/|data:|blob:)/i.test(src)) return tag;

    const cleanSrc = src.split(/[?#]/, 1)[0];
    const scriptFile = cleanSrc.startsWith("/")
      ? resolve(sourceDir, `.${cleanSrc}`)
      : resolve(dirname(htmlFile), cleanSrc);
    const scriptRelative = relative(sourceDir, scriptFile);
    if (scriptRelative.startsWith("..") || isAbsolute(scriptRelative)) {
      throw new Error(`Lo script ${src} esce dalla cartella private in ${relative(sourceDir, htmlFile)}.`);
    }
    if (!statSync(scriptFile, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Script locale non trovato: ${src} (pagina ${relative(sourceDir, htmlFile)}).`);
    }

    const script = readFileSync(scriptFile, "utf8");
    if (/\btype\s*=\s*["']module["']/i.test(attributes) && /\bimport\s*(?:\(|[\w"'{*])/m.test(script)) {
      throw new Error(`Il modulo ${src} importa altri moduli locali. Uniscili in un unico file JavaScript prima del build.`);
    }

    const inlineAttributes = attributes.replace(srcMatch[0], "").trim();
    const safeScript = script.replace(/<\/script/gi, "<\\/script");
    count += 1;
    return `<script${inlineAttributes ? ` ${inlineAttributes}` : ""}>\n${safeScript}\n</script>`;
  });
  return { html: transformed, count };
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
const skippedFiles = files.filter((file) => !/\.(html|css|js|mjs)$/i.test(file));

if (!htmlFiles.some((file) => relative(sourceDir, file).toLowerCase() === "index.html")) {
  throw new Error("La cartella `private` deve contenere `index.html`.");
}
if (!statSync(sharedCss).isFile()) throw new Error("Foglio di stile condiviso `assets/site.css` mancante.");

const password = await hiddenInput("Password condivisa: ");
if (password.length < 16) {
  throw new Error("Usa una password lunga almeno 16 caratteri, unica e non riutilizzata.");
}
const confirmation = await hiddenInput("Ripeti la password: ");
if (password !== confirmation) throw new Error("Le password non corrispondono.");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
copyFileSync(resolve(root, ".nojekyll"), join(outputDir, ".nojekyll"));

mkdirSync(join(outputDir, "css"), { recursive: true });
copyFileSync(sharedCss, join(outputDir, "css", "site.css"));
stdout.write("Copia foglio condiviso: css/site.css\n");

if (skippedFiles.length) {
  stdout.write("\nFile ignorati (non HTML/JS):\n");
  for (const file of skippedFiles) stdout.write(`  ${relative(sourceDir, file)}\n`);
}

for (const file of htmlFiles) {
  const relativePath = relative(sourceDir, file);
  const targetDir = join(outputDir, dirname(relativePath));
  mkdirSync(targetDir, { recursive: true });
  stdout.write(`Cifratura: ${relativePath}\n`);

  const sourceHtml = readFileSync(file, "utf8");
  const htmlWithoutLocalStylesheets = sourceHtml
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) return tag;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (!href || /^(?:https?:|\/\/|data:|\/css\/site\.css(?:[?#]|$))/i.test(href)) return tag;
    return "";
    });
  const hasSharedCss = /href\s*=\s*["'][^"']*\/css\/site\.css(?:[?#][^"']*)?["']/i.test(htmlWithoutLocalStylesheets);
  let htmlForEncryption = htmlWithoutLocalStylesheets;
  if (!hasSharedCss) {
    const link = '    <link rel="stylesheet" href="/css/site.css" />\n';
    if (!/<\/head\s*>/i.test(sourceHtml)) {
      throw new Error(`La pagina ${relativePath} non contiene </head>; impossibile inserire il CSS condiviso.`);
    }
    htmlForEncryption = htmlWithoutLocalStylesheets.replace(/<\/head\s*>/i, `${link}  </head>`);
  }

  const inlined = inlineLocalScripts(htmlForEncryption, file);
  htmlForEncryption = inlined.html;
  if (inlined.count) stdout.write(`  JavaScript locale incorporato: ${inlined.count} file\n`);

  const temporarySource = join(dirname(file), `.build-${process.pid}-${basename(file)}`);
  const temporaryOutput = join(targetDir, basename(temporarySource));
  const finalOutput = join(targetDir, basename(file));
  writeFileSync(temporarySource, htmlForEncryption, "utf8");

  try {
    const result = spawnSync(
      process.execPath,
      [
        staticryptCli,
        temporarySource,
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
    renameSync(temporaryOutput, finalOutput);
  } finally {
    rmSync(temporarySource, { force: true });
    rmSync(temporaryOutput, { force: true });
  }
}

stdout.write(`\nSito cifrato pronto in ${relative(root, outputDir)}\\.\n`);
stdout.write("Controlla che in `docs` ci siano solo pagine cifrate e poi pubblica quella cartella.\n");
