import {
  readdirSync,
  mkdirSync,
  rmSync,
  statSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { tmpdir } from "node:os";

const root = process.cwd();
const sourceDir = resolve(root, "private");
const outputDir = resolve(root, "docs");
const staticryptCli = resolve(root, "node_modules", "staticrypt", "cli", "index.js");
const configPath = resolve(root, ".staticrypt.json");
const passwordTemplate = resolve(root, "password-template.html");
const sharedCss = resolve(root, "assets", "site.css");
const pagesConfig = resolve(sourceDir, "pages.json");

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
    throw new Error("File `private/pages.json` mancante. Crealo con un array di pagine (anche vuoto: []).");
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(pagesConfig, "utf8"));
  } catch (error) {
    throw new Error(`JSON non valido in private/pages.json: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error("`private/pages.json` deve contenere un array JSON.");

  const seenPaths = new Set();
  return entries.map((entry, index) => {
    const row = index + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`La voce ${row} di pages.json deve essere un oggetto.`);
    }
    const { nomeLink, nomePagina, repoGithub, fileSorgente } = entry;
    if (![nomeLink, nomePagina].every((value) => typeof value === "string" && value.trim())) {
      throw new Error(`La voce ${row} di pages.json richiede nomeLink e nomePagina.`);
    }
    if (repoGithub !== undefined && typeof repoGithub !== "string") {
      throw new Error(`repoGithub alla voce ${row} deve essere un URL oppure una stringa vuota per una pagina copiata manualmente.`);
    }

    const pagePath = nomePagina.trim().replaceAll("\\", "/").replace(/^\.\//, "");
    if (pagePath.startsWith("/") || pagePath.split("/").includes("..") || !pagePath.toLowerCase().endsWith(".html")) {
      throw new Error(`nomePagina alla voce ${row} deve essere un percorso HTML relativo dentro private/ (es. tools/analisi.html).`);
    }
    if (pagePath.toLowerCase() === "index.html") {
      throw new Error(`La voce ${row} non può puntare a private/index.html.`);
    }
    if (seenPaths.has(pagePath.toLowerCase())) {
      throw new Error(`La pagina ${pagePath} è registrata più di una volta in pages.json.`);
    }
    seenPaths.add(pagePath.toLowerCase());

    const repoUrl = repoGithub?.trim() ?? "";
    if (repoUrl) {
      let parsedRepo;
      try {
        parsedRepo = new URL(repoUrl);
      } catch {
        throw new Error(`repoGithub alla voce ${row} deve essere un URL HTTPS GitHub.`);
      }
      const repoParts = parsedRepo.pathname.split("/").filter(Boolean);
      if (parsedRepo.protocol !== "https:" || parsedRepo.hostname !== "github.com" || repoParts.length !== 2) {
        throw new Error(`repoGithub alla voce ${row} deve avere il formato https://github.com/utente/repository.`);
      }
    } else {
      const localPage = resolve(sourceDir, pagePath);
      if (!isInside(sourceDir, localPage) || !statSync(localPage, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`La voce ${row} è in modalità manuale: copia prima l'HTML in private/${pagePath} e lascia repoGithub vuoto.`);
      }
    }
    let sourcePath = "";
    if (fileSorgente !== undefined) {
      if (typeof fileSorgente !== "string" || !fileSorgente.trim()) {
        throw new Error(`fileSorgente alla voce ${row}, se presente, deve essere un percorso HTML relativo alla repository.`);
      }
      sourcePath = fileSorgente.trim().replaceAll("\\", "/");
      if (sourcePath.startsWith("/") || sourcePath.split("/").includes("..") || !sourcePath.toLowerCase().endsWith(".html")) {
        throw new Error(`fileSorgente alla voce ${row} deve essere un percorso HTML relativo alla repository.`);
      }
    }
    return { nomeLink: nomeLink.trim(), nomePagina: pagePath, repoGithub: repoUrl, fileSorgente: sourcePath };
  });
}

function isInside(directory, file) {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function copyRepositoryPage(entry, checkoutDir) {
  const rootIndex = ["index.html", "Index.html", "INDEX.HTML"]
    .map((name) => join(checkoutDir, name))
    .find((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
  const rootHtml = readdirSync(checkoutDir, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith(".html"))
    .map((item) => join(checkoutDir, item.name));
  const sourceHtml = entry.fileSorgente
    ? resolve(checkoutDir, entry.fileSorgente)
    : rootIndex ?? (rootHtml.length === 1 ? rootHtml[0] : null);

  if (!sourceHtml || !isInside(checkoutDir, sourceHtml) || !statSync(sourceHtml, { throwIfNoEntry: false })?.isFile()) {
    const candidates = rootHtml.map((file) => basename(file)).join(", ") || "nessun HTML alla radice";
    throw new Error(
      `Non riesco a scegliere l'HTML iniziale in ${entry.repoGithub} (${candidates}). Aggiungi "fileSorgente" alla voce di pages.json, per esempio "tobii-check.html".`,
    );
  }

  const targetHtml = resolve(sourceDir, entry.nomePagina);
  if (!isInside(sourceDir, targetHtml)) throw new Error(`Percorso pagina non valido: ${entry.nomePagina}.`);
  mkdirSync(dirname(targetHtml), { recursive: true });
  const html = readFileSync(sourceHtml, "utf8");

  for (const tag of html.match(/<script\b[^>]*>\s*<\/script\s*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
    if (!src || /^(?:https?:|\/\/|data:|blob:)/i.test(src)) continue;
    const cleanSrc = src.split(/[?#]/, 1)[0];
    const sourceScript = cleanSrc.startsWith("/")
      ? resolve(checkoutDir, `.${cleanSrc}`)
      : resolve(dirname(sourceHtml), cleanSrc);
    if (!isInside(checkoutDir, sourceScript)) throw new Error(`Lo script ${src} esce dalla repository ${entry.repoGithub}.`);
    if (!statSync(sourceScript, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Script locale non trovato nella repository ${entry.repoGithub}: ${src}.`);
    }
    const targetScript = cleanSrc.startsWith("/")
      ? resolve(sourceDir, `.${cleanSrc}`)
      : resolve(dirname(targetHtml), cleanSrc);
    if (!isInside(sourceDir, targetScript)) throw new Error(`Percorso script non valido: ${src}.`);
    mkdirSync(dirname(targetScript), { recursive: true });
    copyFileSync(sourceScript, targetScript);
  }

  writeFileSync(targetHtml, html, "utf8");
}

function cloneAndStagePages(entries, workDir) {
  entries.filter((entry) => entry.repoGithub).forEach((entry, index) => {
    const checkoutDir = join(workDir, `repo-${index + 1}`);
    const repoName = new URL(entry.repoGithub).pathname.replace(/^\//, "").replace(/\.git$/i, "");
    stdout.write(`Recupero ${entry.repoGithub}\n`);
    const result = spawnSync("gh", ["repo", "clone", repoName, checkoutDir, "--", "--depth", "1"], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw new Error(`Impossibile avviare GitHub CLI per ${entry.repoGithub}: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`Download non riuscito per ${entry.repoGithub}. Esegui gh auth status e accedi con gh auth login usando un account autorizzato a leggere la repository.`);
    }
    copyRepositoryPage(entry, checkoutDir);
  });
}

function renderPageLinks(entries) {
  if (!entries.length) {
    return '<p class="portal-empty">Le pagine del laboratorio saranno elencate qui.</p>';
  }
  return `<ul class="portal-links">${entries.map(({ nomeLink, nomePagina }) =>
    `\n          <li><a href="${escapeHtml(nomePagina)}">${escapeHtml(nomeLink)}</a></li>`
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
const workDir = mkdtempSync(join(tmpdir(), "brainlab-pages-"));

try {
cloneAndStagePages(pageEntries, workDir);

const files = collectFiles(sourceDir);
const htmlFiles = files.filter((file) => file.toLowerCase().endsWith(".html"));
const skippedFiles = files.filter((file) => file !== pagesConfig && !/\.(html|css|js|mjs)$/i.test(file));

const availablePages = new Set(htmlFiles.map((file) => relative(sourceDir, file).replaceAll("\\", "/").toLowerCase()));
for (const entry of pageEntries) {
  if (!availablePages.has(entry.nomePagina.toLowerCase())) {
    throw new Error(`Non è stata creata ${entry.nomePagina} dalla repository ${entry.repoGithub}.`);
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
  const htmlWithoutLocalStylesheets = sourceHtml
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) return tag;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (/^(?:\/css\/site\.css(?:[?#]|$))/i.test(href)) return tag;
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
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
