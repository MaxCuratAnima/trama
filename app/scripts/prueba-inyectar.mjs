// ¿Claude lee un mensaje de usuario que llega a mitad de turno (entre herramientas)?
import { spawn } from "node:child_process";
const p = spawn("claude", ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--model", "haiku", "--allowedTools", "Bash"], { shell: true, cwd: process.env.TEMP });
const user = t => p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: t } }) + "\n");
let resultados = 0, buf = "";
p.stdout.on("data", d => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      if (m.type === "result") { resultados++; console.log(`RESULT #${resultados}:`, String(m.result).slice(0, 200)); if (resultados >= 2) p.stdin.end(); }
      else if (m.type === "assistant") for (const c of m.message.content) {
        if (c.type === "text") console.log("TEXTO:", c.text.slice(0, 200));
        if (c.type === "tool_use") console.log("HERRAMIENTA:", JSON.stringify(c.input).slice(0, 120));
      }
      else if (m.type === "user" && m.message?.content?.[0]?.type !== "tool_result") console.log("ECO USER:", JSON.stringify(m).slice(0, 150));
    } catch {}
  }
});
user("Corré en Bash `sleep 6 && echo uno`, después `sleep 6 && echo dos`, después `echo tres`. Uno por vez. Al final resumí.");
setTimeout(() => { console.log(">>> INYECTO"); user("IMPORTANTE: antes del próximo comando escribí la palabra BANANA."); }, 9000);
setTimeout(() => { console.log("TIMEOUT"); p.kill(); process.exit(0); }, 120000);
p.on("exit", () => { console.log("FIN, results:", resultados); process.exit(0); });
