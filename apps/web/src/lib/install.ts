// The install commands come from README.md, so the site and the README can't drift.
// A command the site doesn't know how to explain fails the build.
import { codeBlocks, parse, readRepoFile, section } from "./markdown";
import { toString as mdText } from "mdast-util-to-string";

export interface Step { id: string; title: string; commands: { command: string; note: string }[]; optional: boolean; explain: string; expect: string }

const known: Omit<Step, "commands" | "optional">[] = [
  { id: "clone", title: "Get the source", explain: "Clones the repository into a folder named `hvnt33` and moves into it. Everything else runs from there.", expect: "A new `hvnt33` folder, and your prompt inside it." },
  { id: "install", title: "Install the dependencies", explain: "Installs every part of HVNT33 in one pass: the app, its server and the shared core.", expect: "npm finishes with a package count and no errors. Warnings about funding are fine." },
  { id: "setup", title: "Set it up", explain: "Writes `.env` with a random database password, and installs the built-in database and Tor, each checked against pinned checksums. Run it once.", expect: "Configuration ready, then the database and Tor installed. Keep `.env` private; it holds the database password." },
  { id: "desktop", title: "Open the app", explain: "Builds the app and opens it. The app starts its own server and database; there is nothing else to run.", expect: "The HVNT33 window, with the search bar at the top and the investigation pane on the right." },
  { id: "demo", title: "Load the demo case", explain: "Creates a fictional investigation to explore before you start your own.", expect: "Created the demo case \"Meridian Bay dredging contract (demo)\", with its records and connections. Every person and company in it is invented." },
];

const match: [RegExp, string][] = [
  [/^git clone /, "clone"], [/^cd /, "clone"], [/^npm install$/, "install"], [/^npm run setup$/, "setup"],
  [/^npm run desktop$/, "desktop"], [/^npm run demo$/, "demo"],
];

export function installGuide() {
  const readme = parse(readRepoFile("README.md"));
  const nodes = section(readme, "Install");
  const requirements = nodes.find(n => n.type === "list");
  if (!requirements || requirements.type !== "list") throw new Error("README Install: no requirements list");
  const steps: Step[] = [];
  for (const block of codeBlocks(nodes)) {
    for (const line of block.value.split("\n").filter(Boolean)) {
      const [command, note = ""] = line.split(/\s+#\s+/).map(s => s.trim());
      const id = match.find(([re]) => re.test(command))?.[1];
      if (!id) throw new Error(`README Install has a command the site doesn't explain: ${command}`);
      let step = steps.find(s => s.id === id);
      if (!step) steps.push(step = { ...known.find(k => k.id === id)!, commands: [], optional: false });
      step.commands.push({ command, note });
      if (/^optional/.test(note)) step.optional = true;
    }
  }
  return {
    requirements: requirements.children.map(item => mdText(item)),
    steps,
    firstInvestigation: section(readme, "First investigation"),
  };
}
