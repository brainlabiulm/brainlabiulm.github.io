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
const pagesRoot = resolve(sourceDir, "pages");
const staticryptCli = resolve(root, "node_modules", "staticrypt", "cli", "index.js");
const configPath = ".staticrypt.json";
const passwordTemplate = resolve(root, "password-template.html");
const sharedCss = resolve(root, "assets", "site.css");
const pagesConfig = resolve(pagesRoot, "pages.json");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function readPageLinks() {
  if (!statSync(pagesConfig, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("File `private/pages/pages.json` mancante. Crealo con un array di pagine (anche vuoto: []).");
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(pagesConfig, "utf8"));
  } catch (error) {
    throw new Error(`JSON non valido in private/pages/pages.json: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error("`private/pages/pages.json` deve contenere un array JSON.");

  const seenPaths = new Set();
  return entries.map((entry, index) => {
    const row = index + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`La voce ${row} di pages/pages.json deve essere un oggetto.`);
    }
    const { nomeCartella, nomeLink, nomePagina } = entry;
    if (![nomeCartella, nomeLink, nomePagina].every((value) => typeof value === "string" && value.trim())) {
      throw new Error(`La voce ${row} di pages/pages.json richiede nomeCartella, nomeLink e nomePagina.`);
    }
    const folderName = nomeCartella.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(folderName)) {
      throw new Error(`nomeCartella alla voce ${row} deve essere un nome semplice senza spazi o slash (es. tobii-marker-checker).`);
    }
    const pageFile = nomePagina.trim().replaceAll("\\", "/").replace(/^\.\//, "");
    if (pageFile.startsWith("/") || pageFile.split("/").includes("..") || !pageFile.toLowerCase().endsWith(".html")) {
      throw new Error(`nomePagina alla voce ${row} deve essere il nome o percorso relativo del file HTML dentro la sua cartella (es. index.html).`);
    }
    const pagePath = `pages/${folderName}/${pageFile}`;
    if (seenPaths.has(pagePath.toLowerCase())) {
      throw new Error(`La pagina ${pagePath} è registrata più di una volta in pages.json.`);
    }
    seenPaths.add(pagePath.toLowerCase());

    const localPage = resolve(pagesRoot, folderName, pageFile);
    if (!isInside(pagesRoot, localPage) || !statSync(localPage, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`La pagina manca: copia l'HTML in private/${pagePath}.`);
    }
    return {
      nomeCartella: folderName,
      nomeLink: nomeLink.trim(),
      nomePagina: pageFile,
      pagePath,
    };
  });
}

function isInside(directory, file) {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function renderPageLinks(entries) {
  if (!entries.length) {
    return '<p class="portal-empty">Le pagine del laboratorio saranno elencate qui.</p>';
  }
  return `<ul class="portal-links">${entries.map(({ nomeLink, pagePath }) =>
    `\n          <li><a href="${escapeHtml(pagePath)}">${escapeHtml(nomeLink)}</a></li>`
  ).join("")}\n        </ul>`;
}

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
  const deferredScripts = [];
  let transformed = html.replace(/<script\b([^>]*)>\s*<\/script\s*>/gi, (tag, attributes) => {
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
    const inlineTag = `<script${inlineAttributes ? ` ${inlineAttributes}` : ""}>\n${safeScript}\n</script>`;
    if (/\bdefer\b/i.test(attributes)) {
      deferredScripts.push(inlineTag.replace(/\s+defer\b/i, ""));
      return "";
    }
    return inlineTag;
  });
  if (deferredScripts.length) {
    const scripts = deferredScripts.join("\n");
    transformed = /<\/body\s*>/i.test(transformed)
      ? transformed.replace(/<\/body\s*>/i, `${scripts}\n</body>`)
      : `${transformed}\n${scripts}`;
  }
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

if (!statSync(sourceDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("Cartella `private` mancante. Crea `private/index.html` prima di generare il sito.");
}
if (!statSync(resolve(sourceDir, "index.html"), { throwIfNoEntry: false })?.isFile()) {
  throw new Error("La cartella `private` deve contenere `index.html`.");
}
if (!statSync(sharedCss).isFile()) throw new Error("Foglio di stile condiviso `assets/site.css` mancante.");

const pageEntries = readPageLinks();

const files = collectFiles(sourceDir);
const htmlFiles = files.filter((file) => file.toLowerCase().endsWith(".html"));
const cssFiles = files.filter((file) => file.toLowerCase().endsWith(".css"));
const skippedFiles = files.filter((file) => file !== pagesConfig && !/\.(html|css|js|mjs)$/i.test(file));

const availablePages = new Set(htmlFiles.map((file) => relative(sourceDir, file).replaceAll("\\", "/").toLowerCase()));
for (const entry of pageEntries) {
  if (!availablePages.has(entry.pagePath.toLowerCase())) {
    throw new Error(`La pagina indicata nel catalogo non esiste: private/${entry.pagePath}.`);
  }
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

mkdirSync(join(outputDir, "css"), { recursive: true });
copyFileSync(sharedCss, join(outputDir, "css", "site.css"));
stdout.write("Copia foglio condiviso: css/site.css\n");

for (const file of cssFiles) {
  const target = join(outputDir, relative(sourceDir, file));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  stdout.write(`Copia CSS pagina: ${relative(sourceDir, file)}\n`);
}

if (skippedFiles.length) {
  stdout.write("\nFile ignorati (non HTML/JS):\n");
  for (const file of skippedFiles) stdout.write(`  ${relative(sourceDir, file)}\n`);
}

for (const file of htmlFiles) {
  const relativePath = relative(sourceDir, file);
  const targetDir = join(outputDir, dirname(relativePath));
  mkdirSync(targetDir, { recursive: true });
  stdout.write(`Cifratura: ${relativePath}\n`);

  let sourceHtml = readFileSync(file, "utf8");
  if (relativePath.toLowerCase() === "index.html") {
    const marker = "<!-- PAGE_LINKS -->";
    if (!sourceHtml.includes(marker)) {
      throw new Error("private/index.html deve contenere il segnaposto <!-- PAGE_LINKS --> nell'area elenco pagine.");
    }
    sourceHtml = sourceHtml.replace(marker, renderPageLinks(pageEntries));
  }
  const isPortalHome = relativePath.toLowerCase() === "index.html";
  let htmlForEncryption = sourceHtml.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) return tag;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (/^(?:\/css\/site\.css(?:[?#]|$))/i.test(href)) return "";
    if (/^(?:[a-z]+:)?\/\//i.test(href) || /^data:/i.test(href)) return "";

    const cssPath = href.split(/[?#]/, 1)[0];
    let localCss;
    try {
      localCss = resolve(dirname(file), decodeURIComponent(cssPath));
    } catch {
      throw new Error(`Percorso CSS non valido in ${relativePath}: ${href}`);
    }
    if (!isInside(sourceDir, localCss) || !statSync(localCss, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Il CSS ${href} indicato in ${relativePath} non esiste nella cartella della pagina.`);
    }
    return tag;
  });

  htmlForEncryption = htmlForEncryption.replace(/<body\b([^>]*)>/i, (tag, attributes) => {
    const pageClass = isPortalHome ? "portal-home" : "brainlab-page";
    const classMatch = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
    if (classMatch) {
      const classes = new Set(classMatch[2].split(/\s+/).filter(Boolean));
      classes.add(pageClass);
      return tag.replace(classMatch[0], `class=${classMatch[1]}${[...classes].join(" ")}${classMatch[1]}`);
    }
    return `<body${attributes} class="${pageClass}">`;
  });
  if (!/<body\b/i.test(htmlForEncryption)) {
    throw new Error(`La pagina ${relativePath} non contiene <body>; impossibile applicare il tema BrainLab.`);
  }
  if (!/<\/head\s*>/i.test(htmlForEncryption)) {
    throw new Error(`La pagina ${relativePath} non contiene </head>; impossibile inserire il CSS condiviso.`);
  }
  htmlForEncryption = htmlForEncryption.replace(
    /<\/head\s*>/i,
    '    <link rel="stylesheet" href="/css/site.css" />\n  </head>',
  );

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
stdout.write("Le pagine HTML sono cifrate; i CSS condivisi e locali sono pubblici in `docs`.\n");
