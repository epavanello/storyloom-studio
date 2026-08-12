# Storyloom Studio — contesto, perimetro e obiettivi

Questo documento conserva il contesto di prodotto emerso durante la progettazione iniziale del PoC. È pensato per persone e sessioni AI che devono proseguire il lavoro senza avere accesso alla conversazione originale.

## Visione

Storyloom Studio trasforma un libro in un'esperienza audiovisiva navigabile: l'utente legge o ascolta un capitolo mentre voci espressive e immagini di scena accompagnano il testo in sincronia, mantenendo riconoscibili personaggi, luoghi e continuità narrativa.

Il prodotto non vuole semplicemente creare un audiolibro o una sequenza di immagini. Vuole interpretare la struttura e il senso di un capitolo, costruire una regia coerente e riproducibile e lasciare sempre il testo originale come fonte primaria.

## Obiettivo del PoC

Dimostrare, su un Mac e con un'architettura local-first, che è possibile:

1. importare un libro in EPUB, PDF o testo semplice;
2. ricostruirne capitoli e struttura narrativa;
3. creare un registro stabile dei personaggi e delle loro identità visive e vocali;
4. comprendere un intero capitolo prima di pianificarne la resa;
5. generare on demand una performance audio espressiva, potenzialmente multi-voce;
6. generare poche immagini significative, condizionate dalle reference dei personaggi presenti;
7. sincronizzare testo, battute, audio e immagini usando il tempo reale dell'audio;
8. riprodurre il risultato in un'interfaccia semplice e navigabile;
9. scegliere per ogni capacità se usare modelli locali, cloud o un fallback esplicito.

Il PoC deve privilegiare una verticale completa e credibile su uno o pochi capitoli rispetto a una copertura superficiale di un intero libro.

## Esperienza desiderata

### Preparazione del libro

L'utente importa un libro. Il sistema estrae testo e metadati, identifica capitoli o sezioni equivalenti e assegna identificatori stabili indipendenti dalle pagine del formato di origine.

La pagina non è l'unità narrativa primaria: in un EPUB cambia con dispositivo e impaginazione. Il sistema lavora quindi con capitoli e segmenti semantici, pur potendo presentare una navigazione simile alle pagine.

### Registri di continuità

Il Character Registry è la fonte di verità per ogni personaggio. Deve contenere almeno:

- nome canonico e alias;
- ruolo narrativo;
- prima apparizione;
- descrizione fisica fondata sul testo;
- tratti caratteriali utili alla recitazione;
- immagini di riferimento approvate;
- collegamento a un profilo vocale stabile.

La deduplicazione deve riconoscere varianti di nome, titoli, appellativi e riferimenti indiretti senza fondere personaggi diversi. Il sistema non deve inventare dettagli mancanti spacciandoli per informazioni canoniche.

Accanto ai personaggi, l'evoluzione naturale del progetto prevede un World/Continuity Registry per luoghi, epoca, relazioni, oggetti importanti, abbigliamento, ferite, condizioni ambientali e cambiamenti avvenuti nella storia.

Il Voice Registry resta separato dal Character Registry. Il seed è utile ma non sufficiente a garantire una voce stabile: quando disponibili vanno conservati anche modello, configurazione, reference audio o embedding, stile di parlato e impostazioni espressive.

### Reference visive

Prima di generare le scene, il sistema crea per ogni personaggio principale una piccola scheda visiva coerente: ritratto frontale, tre quarti, profilo o figura intera secondo necessità.

Ogni immagine di scena deve ricevere soltanto le reference dei personaggi effettivamente presenti, associate in modo esplicito ai rispettivi ruoli nella composizione. Lo stile grafico costituisce una reference separata dall'identità dei personaggi.

Le reference aiutano la coerenza ma non la garantiscono. Le scene, soprattutto quelle con più personaggi, devono poter essere validate, rigenerate e in futuro approvate manualmente.

### Regia del capitolo

Prima della generazione, un Chapter Planner legge l'intero capitolo insieme ai registri e alla continuità precedente. Produce un piano strutturato che comprende:

- suddivisione in scene o momenti significativi;
- testo originale distribuito in unità recitative;
- attribuzione delle battute ai personaggi quando sufficientemente certa;
- emozione, intensità, ritmo e pause;
- momenti nei quali un'immagine aggiunge valore;
- personaggi e stato di continuità richiesti in ogni immagine;
- descrizione della scena, inquadratura e atmosfera;
- eventuali effetti sonori o ambiente.

Il testo originale non viene riscritto né arricchito in-place. La regia è uno strato parallelo di annotazioni referenziato tramite identificatori e intervalli del testo. In questo modo si possono rigenerare voci, immagini o interpretazioni senza contaminare il libro.

Il planner prende decisioni creative entro un contratto strutturato. L'orchestratore non improvvisa: valida il piano, applica policy e avvia gli step in modo deterministico.

### Audio e sincronizzazione

La performance può usare un narratore principale e voci distinte per i dialoghi. Per ogni unità recitativa il sistema conserva speaker, profilo vocale, emozione, intensità, ritmo, pause e provenienza del risultato.

La sincronizzazione non dipende obbligatoriamente dal TTS. Il contratto finale richiede timestamp di parole e frasi; se il TTS non li fornisce in modo affidabile, interviene un passaggio separato di forced alignment.

Le immagini sono ancorate ai timestamp audio effettivi, non a durate stimate dal testo. Narrazione, dialoghi, effetti sonori e ambiente devono rimanere tracce concettualmente separate, anche quando il PoC ne riproduce soltanto una parte.

### Riproduzione e controllo

L'utente deve poter:

- navigare tra capitoli o segmenti;
- avviare la preparazione on demand;
- ascoltare la performance seguendo il testo;
- vedere cambiare la scena nel momento previsto;
- riconoscere speaker e stato della generazione;
- consultare i personaggi e le reference;
- riprendere risultati già generati;
- in futuro rigenerare o approvare singoli artifact senza rifare tutto il capitolo.

## Confine tra intelligenza e pipeline deterministica

La parte intelligente è circoscritta a compiti che richiedono comprensione o scelta creativa:

- estrazione e riconciliazione dei personaggi;
- comprensione globale del capitolo;
- attribuzione prudente dei dialoghi;
- direzione della performance;
- scelta dei momenti visuali;
- costruzione dei prompt di scena;
- validazione semantica degli artifact.

Il resto deve essere deterministico, tipizzato, ripetibile e osservabile:

- ingestione e pulizia;
- validazione degli output;
- gestione degli identificatori;
- routing locale/cloud;
- persistenza e cache;
- lifecycle delle risorse;
- generazione tramite provider selezionati;
- allineamento e timeline;
- assemblaggio e riproduzione.

Non è previsto un agente autonomo generico o un workflow engine universale. Per il PoC è preferibile una sequenza piccola di step espliciti e riavviabili.

## Principi di prodotto e progettazione

### On demand

Il libro viene analizzato quanto basta per costruire struttura e registri, ma audio e immagini vengono generati soltanto quando l'utente richiede un capitolo o segmento. La generazione massiva anticipata è fuori dal PoC.

### Local-first, non local-only

Applicazione, libro, registri, cache, artifact e orchestrazione risiedono sul Mac. Ogni capacità può essere locale, cloud o ibrida, purché il passaggio al cloud sia esplicito, registrato e compatibile con la policy di privacy del libro.

Locale e cloud devono condividere i contratti funzionali, non necessariamente gli stessi modelli o pesi. Il routing deve scegliere provider che soddisfano i requisiti qualitativi; non deve degradare silenziosamente verso un provider che ignora reference, timestamp o altri vincoli obbligatori.

### Parsimonia delle risorse

Sul Mac i modelli devono essere caricati soltanto quando servono. La lavorazione ideale raggruppa operazioni dello stesso tipo e mantiene inizialmente una pipeline sequenziale: analisi testuale, rilascio del modello, TTS, rilascio, generazione immagini, rilascio.

### Riproducibilità e provenienza

Ogni artifact deve poter indicare input, configurazione, modello, provider, seed, versione dello schema e data di creazione. A parità di input e configurazione il sistema dovrebbe riusare il risultato. Una rigenerazione intenzionale deve creare una nuova versione, non distruggere silenziosamente la precedente.

### Poco codice e una sola fonte di verità

Il dominio deve rimanere piccolo e indipendente dall'interfaccia. Gli schemi runtime sono la fonte di verità per tipi, output dei modelli, API e dati persistiti. Vanno evitati livelli generici, duplicazione di tipi e infrastruttura prematura.

### Qualità prima della copertura

Le priorità qualitative sono, nell'ordine:

1. fedeltà assoluta al testo originale;
2. identità coerente dei personaggi;
3. attribuzione prudente degli speaker;
4. naturalezza e stabilità delle voci;
5. sincronizzazione audio-testo-immagine;
6. continuità narrativa e visuale;
7. costo e velocità.

## Modalità previste

- **Demo:** nessun modello reale; serve a validare flusso, persistenza, timeline e interfaccia.
- **Locale:** tutti gli step obbligatori usano servizi sul Mac; nessun invio al cloud.
- **Cloud:** usa provider remoti compatibili.
- **Ibrida:** policy distinta per testo, TTS, immagini e allineamento, con fallback dichiarati.

Una modalità non è considerata funzionante finché non viene provata end-to-end con i provider configurati. La presenza di un adapter o di un endpoint non equivale a una validazione reale.

## Cosa non è il PoC

Il perimetro iniziale non comprende:

- generazione preventiva dell'intero libro;
- produzione cinematografica o video animato continuo;
- coerenza perfetta garantita per qualunque stile e numero di personaggi;
- piattaforma multiutente o collaborazione editoriale;
- marketplace, pagamenti, DRM o distribuzione commerciale;
- gestione completa dei diritti sulle opere, voci o likeness;
- editing audio professionale completo;
- database e infrastruttura distribuita;
- orchestratore universale capace di eseguire workflow arbitrari;
- equivalenza esatta tra i modelli locali e quelli cloud.

Questi elementi potranno essere aggiunti soltanto dopo aver validato la verticale principale.

## Criteri di successo del PoC

Una prima versione è davvero riuscita quando, usando un libro campione e almeno un capitolo sostanziale:

1. l'import produce capitoli leggibili e ordinati senza perdere testo;
2. i personaggi principali sono identificati e deduplicati correttamente;
3. le reference approvate rendono gli stessi personaggi riconoscibili in più scene;
4. il planner conserva tutte le parole originali e produce una regia coerente;
5. dialoghi e narratore usano speaker e voci stabili;
6. i timestamp derivano dall'audio o da forced alignment verificabile;
7. le scene cambiano in punti narrativamente sensati;
8. un capitolo interrotto può essere ripreso senza rigenerare tutto;
9. ogni artifact riporta provenienza e configurazione;
10. l'utente può capire e controllare quando i dati lasciano il Mac;
11. l'esperienza completa è sufficientemente naturale da essere valutata sul merito creativo, non soltanto come demo tecnica.

## Stato attuale del repository

Il repository contiene già una verticale dimostrativa SvelteKit con:

- ingestione EPUB/PDF/TXT;
- manifest e schemi condivisi;
- Character e Voice Registry;
- pianificazione del capitolo;
- orchestratore e routing per capacità;
- persistenza su filesystem;
- player con utterance sequenziali e cambi scena;
- provider demo deterministici;
- adapter iniziali per endpoint compatibili con OpenAI.

Questa base dimostra la forma del sistema, ma non ancora la qualità del prodotto. In particolare:

- il Character Registry della demo usa euristiche semplici e produce falsi positivi;
- l'allineamento disponibile è approssimativo, non un forced alignment reale;
- TTS e immagini reali non sono stati validati end-to-end sul Mac target;
- il lifecycle coordinato dei modelli locali è ancora da implementare;
- la cache non è ancora indirizzata da contenuto e configurazione;
- la validazione automatica della coerenza delle immagini non è presente;
- alcune affermazioni del README descrivono l'architettura prevista più che capacità già verificate.

Test e build della demo passano al momento della stesura di questo documento. Il type-check richiede la stabilizzazione delle versioni TypeScript/Svelte, perché l'uso di dipendenze `latest` ha installato una combinazione non supportata.

## Percorso di lavoro consigliato

### Fase 1 — Baseline affidabile

- fissare versioni compatibili delle dipendenze;
- rendere verdi test, type-check e build;
- inizializzare la storia Git;
- separare chiaramente funzionalità demo, implementate e pianificate;
- aggiungere validazioni di integrità del testo e del piano.

### Fase 2 — Verticale locale reale

- scegliere un libro/capitolo campione e criteri di valutazione;
- collegare e validare un modello testuale in LM Studio;
- correggere estrazione, deduplicazione e aggiornamento incrementale dei personaggi;
- collegare un TTS italiano locale con profili vocali stabili;
- introdurre forced alignment reale;
- verificare la timeline completa nel player.

### Fase 3 — Coerenza visuale

- definire e approvare stile e character sheet;
- integrare un generatore che supporti realmente più reference;
- rappresentare stato e ruolo dei personaggi nella composizione;
- aggiungere validazione e rigenerazione degli artifact;
- misurare la coerenza sulle stesse identità in più scene.

### Fase 4 — Ibrido e resilienza

- verificare adapter cloud reali;
- applicare policy per capacità e privacy;
- aggiungere provenance, hashing e versionamento degli artifact;
- implementare fallback soltanto tra provider con capacità equivalenti;
- coordinare caricamento, TTL e rilascio dei modelli locali.

### Fase 5 — Valutazione del PoC

- eseguire un capitolo completo sul Mac target;
- misurare RAM, durata, costo cloud e spazio disco;
- valutare fedeltà, voce, sincronizzazione e coerenza visuale;
- raccogliere gli interventi manuali necessari;
- decidere se proseguire verso prodotto, strumento editoriale o esperienza personale.

## Decisioni ancora aperte

Prima della validazione qualitativa servono decisioni esplicite su:

- libro e capitolo campione, inclusa la lingua;
- quantità di memoria del Mac target;
- stile visuale desiderato;
- densità indicativa delle immagini;
- narratore unico o cast multi-voce già nel primo test;
- uso di voice cloning e relativi diritti;
- dati che possono essere inviati al cloud;
- livello di approvazione manuale accettabile;
- priorità tra velocità, qualità, costo e privacy.

Queste decisioni non vanno inventate da una sessione AI se cambiano materialmente il risultato.

## Regole per chi prosegue il progetto

1. Leggere questo documento e il README prima di proporre cambiamenti.
2. Verificare il codice e i test: questo documento descrive l'intento, non sostituisce la realtà del repository.
3. Non modificare o parafrasare il testo originale durante la pianificazione della performance.
4. Non spostare decisioni creative dentro l'orchestratore deterministico.
5. Non dichiarare una modalità locale, cloud o ibrida come funzionante senza una prova end-to-end.
6. Non effettuare fallback cloud silenziosi.
7. Non assumere che un seed garantisca identità vocale o visuale.
8. Non assumere che un endpoint OpenAI-compatible supporti immagini reference-conditioned, TTS espressivo o timestamp: verificare ogni capacità.
9. Conservare provenance e versioni quando si rigenerano artifact.
10. Preferire la verticale più piccola che consenta una valutazione qualitativa reale.

## Brief sintetico per una nuova sessione AI

> Storyloom Studio è un PoC local-first che trasforma libri EPUB/PDF/TXT in capitoli audiovisivi on demand. Il testo originale resta immutabile; un Chapter Planner legge l'intero capitolo e produce annotazioni strutturate per speaker, emozioni, pause, scene e continuità. Character e Voice Registry stabilizzano identità visive e vocali. L'orchestratore è deterministico e coordina provider locali/cloud per analisi, TTS, forced alignment e immagini condizionate dalle reference. La priorità è validare una verticale qualitativa completa su un capitolo, non generare l'intero libro. La demo esistente prova il flusso ma usa ancora estrazione personaggi e allineamento approssimativi; i provider reali e il lifecycle dei modelli locali devono essere validati sul Mac target.

