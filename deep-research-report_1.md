# Deep Research: Erweiterung von Agent-Orchestrator zu einer lokalen Orchestrierungs- und Trainings-App

## Was das Repository heute bereits leistet

Das Repository implementiert bereits einen funktionsfähigen, **hierarchischen Multi-Agenten-Orchestrator** (Orchestrator → Lead Agents → Workers) und operationalisiert “Agent-Engineering” sehr pragmatisch über **Datei-basierte Artefakte** (Goal/Plan/Tasks/Status/Logs), **persistente Mental Models** (YAML) und **Skill-Dokumente** (Markdown). Der Einstieg erfolgt über ein Startskript, das Workspace-Dateien initialisiert und anschließend einen Orchestrator in einer `tmux`-Session startet. citeturn17view1turn16view4

### Ausführungsmodell und Prozess-Isolation über `tmux` + `pi`
- `run.sh` erzeugt/initialisiert u. a. `workspace/goal.md`, `workspace/plan.md`, `workspace/status.md` und `workspace/log.md` (Templates werden kopiert) und startet anschließend eine `tmux`-Session, in der der Orchestrator via `pi --extension ...` läuft. citeturn16view4turn17view1  
- Die Orchestrierung selbst geschieht über ein TypeScript-Extension-Modul (`extensions/orchestrator.ts`), das im Kern eine **Delegation** als Spawn eines neuen `pi`-Prozesses in einem neuen `tmux`-Pane umsetzt und diesen Worker-Prozess dann über `monitor` beobachtbar macht. citeturn12view1turn12view2turn12view3  
- Der `delegate`-Tool-Text beschreibt explizit, dass beim Spawn die **System-Prompt-Datei des Zielagenten**, dessen **Mental Model** und **Skills** injiziert werden; zudem wird der Pane/Task-Kontext zur späteren Überwachung zurückgegeben. citeturn12view1turn12view3

### Team- und Agenten-Definition per YAML + Markdown-Frontmatter
- Die Teamstruktur ist bereits **konfigurierbar** über `multi-team-config.yaml` (Teams: Planning/Engineering/Validation mit jeweils Lead + Workers; plus Orchestrator). citeturn14view0turn13view6  
- Agenten sind als Markdown-Dateien mit Frontmatter organisiert, inkl. **Model-Auswahl**, **Skills**, **Tools** und **Domain-/Pfad-Rechten**. Das sieht man z. B. am Orchestrator-Prompt (Model `google/gemini-2.5-pro`, Skills wie `task-decomposition` + `notebooklm`, Tool-Rechte inkl. `delegate`, `query_notebooklm`). citeturn24view0turn31view0  
- Worker-Prompts (Beispiel „Backend Dev“) enthalten zusätzlich eine **Domain-Whitelist** (welche Pfade der Agent lesen/schreiben darf), eine Arbeitsanweisung (erst Log lesen, Task lesen, Plan lesen, implementieren) sowie formale Handoff- und Status-Regeln. citeturn29view0  

### Task- und Qualitätsmechaniken: Plan-Gate, Handoff-Report, Reconcile-Loop
Das Repo spiegelt bereits mehrere „Agentic Engineering“ Best Practices wider:
- **Plan-Approval Gate:** Delegierte Tasks können im Zwei-Phasen-Modus laufen (Phase Plan → Status `plan_ready` → Lead prüft → Status `plan_approved` → Phase Execute). Das ist sowohl als Delegations-Option (`plan_first`) im Orchestrator-Tooling angelegt als auch als explizites Worker-Protokoll dokumentiert. citeturn12view1turn29view0turn35view0  
- **Strukturierte Handoff-Reports:** Ausgaben sollen (statt freiform) in vier Blöcken erfolgen: *Changes Made / Patterns Followed / Unresolved Concerns / Suggested Follow-up Tasks*. Das ist als Template dokumentiert und in Worker-Prompts verankert. citeturn33view0turn29view0turn35view0  
- **Reconcile/Validate Loop:** `reconcile` führt einen Validierungsbefehl aus (z. B. `tsc --noEmit`, `npm test`) und erstellt bei Failure automatisch einen Fix-Task. Das ist als Tool im Extension-Code implementiert und als Prozessregel im Orchestrator-Prompt beschrieben. citeturn8view2turn35view0turn24view0  

### Persistente Mental Models und Skill-Injektion
- Das Repo nutzt pro Agent ein YAML-Mental-Model mit festen Kategorien wie `preferences`, `patterns_learned`, `strengths`, `mistakes_to_avoid`, `collaborations`. Die Dateien tragen zudem ein `updated`-Datum (z. B. „Backend Dev“ und „Orchestrator“ zuletzt „2026-04-04“). citeturn20view0turn21view0  
- Das Tool `update_mental_model` hängt Learnings **append-only** an und kann für `patterns_learned` außerdem Kontext + Confidence speichern; das entspricht einem bewusst „leichten“ Persistenzmodell, das nicht Gewichte verändert, sondern textuelle/strukturierte Memory aufbaut. citeturn22view1turn22view2  
- Skills sind als Markdown-Dokumente im `skills/`-Ordner abgelegt (z. B. „NotebookLM Research Skill“), und die Prompts referenzieren diese Skill-Dateien explizit. citeturn31view0turn24view0turn29view0  

### NotebookLM-Integration als „source-grounded“ Research-Tool
- Das Repo integriert NotebookLM als optionales Tool (`query_notebooklm`), aktiviert per Config-Flag (`notebooklm.enabled: true`) und Skill-Pfad. citeturn14view0turn13view1  
- Das Tool ruft ein Python-Skript auf (u. a. `ask_question.py` im konfigurierten Skill-Verzeichnis), extrahiert die Antwort aus dem Output und loggt die Query. citeturn13view1  
- Das Skill-Dokument beschreibt den Zweck als **nur aus hochgeladenen Dokumenten** antwortendes System (keine Internet-Recherche) sowie Limitierungen (u. a. Rate Limits) und Best Practices (konkret/kontextreich fragen, nur ein Thema pro Query). citeturn31view0  

### Bereits vorhandener Kern einer „lokalen App“: Web UI + File Watcher
Neben CLI/`tmux` existiert bereits eine lokale Web-Oberfläche:
- Ein Express-Server stellt API-Routen bereit (Workspace/Tasks/Agents/Config/Session/Skills/NotebookLM etc.), serviert statische Frontend-Dateien und hängt WebSockets an; Standard-Port ist (konfigurierbar) `3000`. citeturn44view0turn39view0  
- Ein File-Watcher überwacht nicht nur Tasks, sondern auch `workspace/{goal,plan,status,log}`, `mental-models`, `agents`, `skills` sowie den YAML-Config-File; Task-Dateien werden beim Change geparst, Log-Tabellenzeilen als Events emittiert. citeturn42view1turn42view0  

**Zwischenfazit:** Dein Repo ist bereits mehr als ein „Ansatz“: Es ist ein lauffähiger Orchestrierungs-Stack mit (a) Team-/Agent-Registry, (b) Task-Workflow, (c) persistenten mentalen Modellen, (d) Quality-Gates und (e) einer lokalen UI, die auf Dateiänderungen reagiert. citeturn14view0turn12view1turn22view2turn44view0turn42view1  

## Zielbild für die lokale Orchestrierungs-App

Dein Ziel erweitert das aktuelle System entlang drei Achsen:

**Erstens:** „Maßgeschneiderte Agenten trainieren“ – nicht im Sinne von Weight-Fine-Tuning, sondern als **kontinuierliche Verbesserung eines persistenten Agentenprofils** (Prompt + Skills + Memory/Mental Model + messbare Kompetenz). Das passt sehr gut zu dem bereits implementierten *append-only Mental Model* und der NotebookLM-gestützten Recherche. citeturn22view2turn31view0turn13view1  

**Zweitens:** „Team zusammenstellen“ – (a) manuell via UI, (b) automatisch via Meta-Agent, der Teamzusammenstellung beherrscht. Das ist eine natürliche Fortführung der schon vorhandenen `multi-team-config.yaml`-Struktur sowie der `list_team`/Delegation-Tools. citeturn14view0turn13view6turn12view1  

**Drittens:** „Gamification“ – Skill Level + Spezialisierung + Training als progressionsfähiger Prozess, wobei Qualität > Quantität gilt. Hier muss die App bewusst Mechaniken gegen „Grinden“ und gegen metrisches Gaming bauen (z. B. XP nur bei nachgewiesener Qualität). Für die Begrifflichkeit liefert die Gamification-Definition (Game-Design-Elemente in Nicht-Spiel-Kontexten) einen klaren Rahmen. citeturn43search9  

Wichtig dabei: Deine Codebasis bringt bereits zwei Kernkomponenten mit, die man für eine „lokale Orchestrierungs-App“ typischerweise mühsam erst bauen müsste:
1) **Eventing + UI-Backbone** durch den File-Watcher und WebSocket-Updates. citeturn42view1turn44view0  
2) **Operationalisierte Qualitätsschleifen** (Plan-Gate, Reconcile, strukturierte Reports), die man direkt für Skill-Messung und XP-Berechnung nutzen kann. citeturn35view0turn8view2turn33view0  

## Agent-Training als Qualitätsprozess

### Training als „Memory + Protokoll + Evidenz“ statt Fine-Tuning
Für dein Trainingsverständnis existiert in der Forschung ein sehr passendes Paradigma: **Reflexion-basierte Verbesserung ohne Gewichts-Update**. Die Arbeit *Reflexion: Language Agents with Verbal Reinforcement Learning* beschreibt genau den Ansatz, aus Feedback linguistische Reflexionen zu generieren und diese in einem episodischen Memory zu speichern, um in späteren Trials bessere Entscheidungen zu treffen – ohne Modell-Finetuning. citeturn43search0turn43search4  

Dein Repository implementiert de facto bereits den „praktischen Kern“ davon:
- Persistente, agent-spezifische YAML-Modelle. citeturn20view0turn21view0  
- Ein Tool, das Learnings **append-only** und teilweise mit Confidence ablegt. citeturn22view2  

**Erweiterungsidee:** Baue Training als Pipeline, die pro abgeschlossenem Task drei Outputs erzeugt:
1) **Outcome Evidence**: Tests/Reconcile/Checks + Artefaktlinks (Diff/Dateien). citeturn8view2turn33view0  
2) **Reflection Summary**: komprimierte Learnings (max. 1–3 Einträge), jeweils mit *Kontext, Hypothese, Confidence* (Quality>Quantity). citeturn22view2turn43search0  
3) **Skill Update**: quantisierte Skill-Dimensionen (z. B. „API-Design“, „Teststrategie“, „Delegationshygiene“) als numerische Werte – aber nur wenn Evidence vorhanden ist. citeturn33view0turn8view2  

### Strikte Qualitätskriterien über Gatekeeping und Validierung
Das System hat bereits ein „Qualitäts-Gerüst“, das du für echtes Training (im Sinne von Kompetenzaufbau) nutzen kannst:
- **Plan-Approval Gate** verhindert vorschnelles Implementieren und erzeugt prüfbare Entscheidungen (Plan-Qualität, Risikobewusstsein, Scope-Disziplin). citeturn12view1turn29view0turn35view0  
- **Reconcile** liefert harte Outcome-Signale (pass/fail) und erzeugt automatisch Fix-Tasks; ideal als mechanischer Input für Skill-Wertungen wie „Reliability“ oder „Build Hygiene“. citeturn8view2turn11view2  
- **Strukturierte Handoff-Reports** geben dir standardisierte Trainingsdaten über Patterns/Unresolved Concerns/Next Steps (und reduzieren das Risiko, dass „viel Text“ mit „viel Fortschritt“ verwechselt wird). citeturn33view0turn29view0  

### Tool-Use und Research als Teil des Trainings
Dein Training umfasst explizit „lernen anhand von NotebookLM oder ähnlicher Recherche“. NotebookLM wird im Repo als „source-grounded“ Tool beschrieben (nur hochgeladene Quellen) und auch als integriertes Tool realisiert – inklusive Prozess/Best Practices. citeturn31view0turn13view1  

Hier lohnt sich ein klarer Trainingsmechanismus:
- XP/Skill-Fortschritt **nur**, wenn Research in *Patterns Followed* oder *Proposed Approach* konkret und nachweisbar „in Code/Decision“ überführt wurde. Das ist kompatibel mit dem strukturierten Task-Report-Template. citeturn33view0turn29view0  
- Abgleich „Reasoning ↔ Acting“: Die ReAct-Arbeit motiviert die Idee, Reasoning-Spuren mit konkreten Aktionen (Tool Calls/Changes) zu verzahnen, um Halluzination und Fehlerfortpflanzung zu reduzieren. In deinem System wäre das: Plan/Reasoning → implementierte Änderungen → Reconcile/Tests. citeturn43search1turn8view2turn35view0  

## Gamification: Skill Levels, Spezialisierung, Quests

Gamification wird klassisch als „use of game design elements in non-game contexts“ definiert. citeturn43search9  
Für dein Vorhaben (Skill Level, Training, Teamplay) ist das nützlich – aber du brauchst Mechaniken, die **Qualität bevorzugen** und nicht Quantität.

### Evidenzlage und Design-Implikationen
Empirische Reviews zeigen tendenziell positive Effekte, aber stark abhängig von Kontext, Design und Messung:
- Hamari et al. (2014) fassen empirische Studien zusammen und diskutieren, dass Effekte existieren, aber nicht universell sind und von Implementationsdetails abhängen. citeturn43search12turn43search2  
- Koivisto & Hamari (2019) rahmen Gamification als Designansatz zur Erzeugung „gameful experiences“ und Motivation, was die Notwendigkeit unterstreicht, nicht nur Metriken zu gamifizieren, sondern Motivation/Feedback sinnvoll zu gestalten. citeturn43search6  

### Konkretes Gamification-Modell, das zu deinem Repo passt
Du hast bereits klare Artefakte, die man „punkten“ kann: Task-Dateien, Status, Reconcile-Outputs, strukturierte Reports, Mental-Model-Updates. citeturn13view5turn8view2turn22view2turn33view0  

Ein robustes, quality-first Modell kann so aussehen:

**Skill-Dimensionen (Beispiele)**
- Engineering: API-Design, Teststrategie, Security Hygiene, Refactoring Disziplin  
- Orchestration: Task-Zerlegung, Dependency-Handling (Waves), Review/Plan-Approval Qualität  
- Research: Quellenorientierung, Übertragung in Entscheidungen/Code  

Diese Dimensionen sind in deinem Repo bereits durch Skills/Prompts strukturiert (z. B. `skills/api-design.md`, `skills/testing-strategy.md`, NotebookLM Skill). citeturn31view0turn30view0  

**XP-Berechnung (qualitätsgewichtetes Signal)**
- XP = Difficulty × QualityScore × NoveltyFactor, mit:
  - QualityScore stark gekoppelt an: Reconcile-Pass, Test-Pass, Review-Freigabe, Report-Compliance. citeturn8view2turn33view0turn12view1  
  - NoveltyFactor sinkt bei Wiederholung gleicher Task-Typen (Anti-Grind).  
- Optional: „Penalty Budget“ bei Regressionen (z. B. neue Tests brechen) über Fix-Task-Rate. citeturn8view2turn11view2  

**Skill Level vs. Spezialgebiet**
- Spezialgebiet = deklarative „Primary Domain“ (z. B. Backend, UX) + empirische Bestätigung (hohe QualityScores in passenden Quest-Typen).  
- Level = progressiver, aber nicht linearer Score (z. B. Levelkurve), damit Fortschritt sichtbar ist, aber nicht exponentiell durch Quantität. citeturn43search9turn43search6  

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["gamification skill tree UI dashboard","multi agent orchestration dashboard ui","task management kanban gamified","agent performance analytics dashboard"],"num_per_query":1}

### Quests und Trainings-Curricula
Der wichtigste Hebel für „Training“ ist ein **Curriculum**: standardisierte Aufgaben, die Skills isoliert testen. Dein Repo hat dafür bereits das Task-Format und eine Validierungsschleife. citeturn13view4turn8view2turn33view0  

Ein anschlussfähiges Quest-Design:
- „Micro-Quests“: kleine Aufgaben mit klarer Done-Definition (z. B. eine API-Route + Tests).  
- „Boss-Fights“: komplexe Aufgaben mit Wave-Dependencies; hier werden Orchestration-Skills mitgeprüft (Waves/Monitor/Reconcile). citeturn24view0turn8view2  
- „Research Quests“: NotebookLM-Abfrage → zusammengefasste Entscheidung → implementierte Änderung → Evaluation; XP nur bei nachweisbarer Umsetzung. citeturn31view0turn33view0  

## Meta-Agent für Teamzusammenstellung

### Problemdefinition
Ein Meta-Agent für Teamzusammenstellung braucht:
1) eine formal beschreibbare Aufgabe („aus Goal + Constraints ein Team + Rollen + Runbook ableiten“),  
2) eine Datenbasis („welche Agenten gibt es, welche Skills, wie gut sind sie, wofür taugen sie“),  
3) Feedback/Labels („war das Team erfolgreich?“).  

Dein Repo liefert bereits (a) eine Agent Registry (YAML + Agent-Dateien), (b) Task-/Outcome-Artefakte, (c) persistente Mental Models – also die Rohdaten, aus denen man Team-Performance ableiten kann. citeturn14view0turn22view2turn13view5turn42view1  

### Architekturansatz: Heuristik zuerst, Meta-Agent danach
Für Stabilität empfehlt sich eine zweistufige Strategie:

**Stufe A: Deterministische Team-Auswahl (Baseline)**
- Mappe Goal → benötigte Rollen/Kompetenzen.  
- Wähle Agenten nach (SkillMatch × Reliability × Availability).  
- Erzwinge Coverage (mindestens ein Agent pro Pflichtrolle).  

Diese Stufe ist wichtig, um „immer ein brauchbares Ergebnis“ zu haben – auch wenn der Meta-Agent unsicher ist.

**Stufe B: Meta-Agent als Optimierer**
- Der Meta-Agent schlägt Alternativen vor („Team A vs Team B“), inklusive Begründung und erwarteter Risiken.  
- Training/Verbesserung geschieht über Outcome-Feedback (z. B. Reconcile-Failures, Fix-Task-Quote, Review-Iterations) und über Reflexionseinträge analog zu Reflexion (sprachliche Verbesserung statt Weight-Update). citeturn8view2turn43search0turn22view2  

### Engineering-Optionen für Multi-Agent Orchestration
Wenn du perspektivisch von `tmux`/Subprozessen zu einem flexibleren Runtime-Modell willst, sind zwei etablierte Richtungen gut anschlussfähig:
- **AutoGen** (Microsoft) beschreibt sich als event-driven Framework für skalierbare Multi-Agent-Systeme. Das ist konzeptionell nah an deinem bestehenden Eventing (FileWatcher/WebSockets) und kann als Inspirationsquelle dienen. citeturn43search3turn43search20  
- **LangGraph** positioniert sich als Low-Level-Orchestrierungsframework für zuverlässige Agentensteuerung („Balance agent control with agency“). Das passt zu deinem Fokus auf Quality Gates und deterministische Scheduling-Mechaniken (Waves/Reconcile). citeturn43search16turn24view0turn8view2  

## Architekturvorschlag und Datenmodell

### Lokale Orchestrierungs-App als Evolution deiner bestehenden Web UI
Da dein Repo bereits ein lokales Web UI mit API, WebSockets und File-Watching besitzt, ist eine naheliegende Strategie: **aus dem bestehenden Web-Modul die „Orchestrator App“ machen**, statt bei Null mit Desktop-Stack anzufangen. citeturn44view0turn42view1  

Der FileWatcher überwacht bereits exakt die Artefakte, die du für Training/Gamification brauchst (Tasks, Logs, Mental Models, Agent-Prompts, Skills). citeturn42view1  

**Konkreter Ausbaupfad:**
- UI: Agent Registry Editor, Skill Tree View, Training/Quest Manager, Team Builder, Outcome Dashboard.  
- Backend: Trainings-Controller, Evaluations-Service, Score-/XP-Service, Meta-Agent-Service, Secrets/Provider-Adapter.

### Datenmodell als „Single Source of Truth“
Heute ist vieles file-basiert (Markdown/YAML). Das ist gut für Transparenz, aber für Gamification brauchst du zusätzliche strukturierte Daten (Historie, Scores, Quests, Leaderboards).

Ein praktikables Modell ist „Dateien bleiben autoritativ für Prompts/Skills/Mental Models, aber Scores und Trainingshistorie landen in einer lokalen DB“ (z. B. SQLite). Der FileWatcher kann Änderungen zurück in den State spiegeln. citeturn42view1turn22view2  

**Mindestens benötigte Entitäten:**
- Agent: id, name, specialtyTags, toolPermissions, domainPermissions, skillLevels  
- TaskRun: taskId, agentId, timestamps, outcome(pass/fail), reconcileEvidence, reportQualityScore  
- SkillProgress: agentId, skillKey, level, xp, evidenceRefs  
- TeamRun: goalId, teamSnapshot, metrics, retrospectives  

### Runtime: Prozessmanagement, Isolation, Cross-Platform
Aktuell nutzt du `tmux split-window` für parallele Agentenläufe und fällst (wenn `tmux` fehlt) auf Background-Prozesse zurück. Das ist auf Linux sehr effektiv, aber für eine „App“ (Windows/macOS) potenziell ein Haupt-Risiko. citeturn12view2turn8view5  

Ein App-tauglicher Evolutionspfad wäre:
- Phase 1: `tmux` bleibt optional, aber UI kontrolliert Sessions über API (du hast bereits `/api/tmux`-Routing vorbereitet). citeturn44view0turn39view0  
- Phase 2: abstrahiertes „Session Runtime Interface“ (tmux/pty/container) – dazu passen event-driven Framework-Ideen wie bei AutoGen. citeturn43search3turn43search20turn42view1  

## Risiken, Sicherheit und Governance

### Secrets und Provider-Zugriffe
`run.sh` zeigt, dass du für Claude/ACP Credentials aus `~/.claude/credentials.json` ausliest und ein OAuth-Token als Environment Variable exportierst. Für eine lokale App bedeutet das: Secrets dürfen **nicht** in Logs/Task-Files landen und sollten idealerweise in OS-Keychain/Secret-Store verwaltet werden. citeturn16view2turn16view3  

Zusätzlich: NotebookLM-Integration nutzt lokale Skill-Pfade und Python-Ausführung. Das ist mächtig, aber in einer App musst du strikt kontrollieren:
- wo Skripte herkommen (Supply Chain),  
- welche Parameter geloggt werden,  
- und ob Notebook-IDs/Fragen sensitive Inhalte enthalten. citeturn13view1turn31view0  

### „Gaming the Game“ und Qualitätswahrung
Sobald XP/Level existieren, wird es Optimierungsdruck geben. Dein System hat bereits Anti-Pattern Guards („keine Out-of-Scope Fixes“, „nicht nach oben delegieren“, „Mental Models nur delta“). Diese Regeln sind eine ideale Basis, um Gamification vor Metrik-Gaming zu schützen – insbesondere, wenn XP an Reconcile/Report-Compliance gekoppelt ist. citeturn29view0turn8view2turn33view0  

Die Gamification-Literatur macht klar, dass Effekte stark vom Design abhängen; in deinem Kontext heißt das: **Messung muss echte Qualität repräsentieren**, sonst belohnst du nur Textproduktion oder triviale Tasks. citeturn43search12turn43search6turn43search9  

### Governance für Mental-Model-Updates
Da Mental Models kumulativ wachsen, brauchst du Mechanismen gegen „Memory Drift“:
- Einträge mit Confidence (hast du für `patterns_learned`) sollten nachträglich prüfbar/abwertbar sein. citeturn22view2  
- „Quality > Quantity“ operationalisieren: pro Task maximal N Learnings, und nur bei Evidence (Reconcile/Review/Outcome). citeturn8view2turn43search0  

**Kernpunkt:** Dein Repo ist bereits sehr nahe an deiner Vision. Die größte inhaltliche Erweiterung liegt weniger in „noch mehr Orchestrierung“ als in einem **Trainings- und Scoring-Layer** (Curriculum + Evaluation + XP/Skill Trees) plus einem **Meta-Agenten**, der auf Basis dieser Daten Teamzusammenstellungen optimiert. citeturn42view1turn22view2turn43search0turn43search9