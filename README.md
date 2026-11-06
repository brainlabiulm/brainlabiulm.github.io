# Portale BrainLab

Portale statico con password condivisa, pensato per la pubblicazione su GitHub Pages. La grafica riprende la palette blu notte e viola tenue, i pannelli chiari e la tipografia dell'app Tobii del laboratorio.

## Protezione e repository pubblico

La repository GitHub è pubblica. Per questo i sorgenti in chiaro stanno nella cartella locale `private/`, che è esclusa da Git. Il sito pubblicabile viene generato in `docs/` cifrando ogni file HTML con StatiCrypt e la password scelta al momento della generazione.

Non rimuovere `private/` da `.gitignore` e non aggiungere pagine in chiaro alla repository. La password non viene salvata nello script, nella configurazione o nell'output del sito. Usa una password unica di almeno 16 caratteri e condividila tramite un canale separato dal link.

Questa soluzione usa una sola password condivisa: non identifica i singoli visitatori e non consente di revocare l'accesso a una persona senza cambiare la password per tutti. Non usarla per dati clinici, personali o altrimenti sensibili. Le pagine HTML vengono cifrate; eventuali PDF, immagini, fogli di stile o altri file aggiunti separatamente non sono cifrati da questo progetto e non vanno pubblicati se riservati.

## Preparazione e generazione

Richiede Node.js 16 o successivo. Nella cartella del progetto:

```powershell
npm install
npm run build
```

Lo script chiede la password due volte senza mostrarla, controlla che sia lunga almeno 16 caratteri e genera le pagine cifrate in `docs/`. Puoi accedere una volta e usare “Ricordami” per aprire le altre pagine dello stesso sito senza reinserirla a ogni click.

Per aggiungere pagine, copia i file `.html` dentro `private/` mantenendo la struttura delle sottocartelle e registra ogni pagina nell'array `private/pages.json` (puoi copiare `pages.example.json` come modello). Per esempio:

```json
[
  {
    "nomeLink": "Analisi dati",
    "nomePagina": "pages/analisi.html",
    "repoGithub": "https://github.com/organizzazione/repository"
  }
]
```

`nomeLink` è l'etichetta mostrata nel portale; `nomePagina` è il percorso relativo del file HTML presente in `private/`; `repoGithub` indica la repository sorgente. Il build controlla che il file HTML esista e genera automaticamente il link nella pagina iniziale. `pages.json` si trova dentro `private/` ed è escluso dalla repository pubblica insieme alle pagine in chiaro.

Per ora il JSON registra le repository ma non le scarica automaticamente: copia prima i file della pagina dentro `private/`. Per sincronizzare repository private senza copie manuali bisogna configurare un token GitHub con accesso in sola lettura e una procedura di build automatica; il token va conservato come secret e mai scritto nel JSON.

Il foglio di stile comune è `assets/site.css`: viene pubblicato come `docs/css/site.css` e collegato automaticamente a ogni HTML cifrato. Puoi quindi copiare HTML e JavaScript senza portare un CSS per ogni pagina. Gli eventuali link HTML a fogli di stile locali e i blocchi `<style>` vengono rimossi durante la generazione; le pagine useranno lo stile comune. Se una pagina richiede regole particolari, possiamo aggiungerle al foglio comune.

Gli script locali `.js` e `.mjs` referenziati nell'HTML vengono incorporati nella pagina prima della cifratura, quindi non vengono pubblicati come file separati. Gli script remoti restano remoti. I moduli JavaScript con import locali devono essere uniti in un singolo file prima del build. I formati diversi da HTML e JavaScript (PDF, immagini, JSON e così via) sono ignorati per non pubblicarli per errore; se una pagina usa tali risorse, andranno gestite separatamente.

## Pubblicazione su GitHub Pages

1. Esegui `npm run build` e controlla che `docs/` contenga solo pagine cifrate.
2. Aggiungi e carica la cartella `docs/` cifrata e i file di progetto; non caricare mai `private/`.
3. In GitHub apri **Settings → Pages**, scegli **Deploy from a branch**, seleziona `main` e la cartella `/docs`.
4. Dopo la pubblicazione, visita `https://brainlabiulm.github.io/` e prova la password prima di condividere il link.

Se cambi password, rigenera tutte le pagine con `npm run build` e ripubblica la nuova cartella `docs/`. Le copie precedenti potrebbero restare nella cronologia Git: la password va quindi mantenuta riservata e ruotata se viene divulgata.
