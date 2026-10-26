# Trama

Trama es una app de escritorio para trabajar con varios agentes de Claude Code (o Gemini) a la vez:
un líder que reparte tareas y workers que las hacen, cada uno en su propio worktree de git, y un
tablero donde quedan las preguntas que necesitan tu respuesta.

Tiene dos partes:

- **app/**: la interfaz, en Electron y en el navegador.
- **motor/**: `pa` (delegar trabajo a un worker), `tablero` (pendientes y preguntas), `trama-motor`
  (el servidor sin ventana, en `127.0.0.1:8791`) y los hooks que protegen a los workers.

## Requisitos

- Claude Code (`claude`) con tu cuenta, o `agy` (Gemini) con la tuya.
- Git.
- Opcional: [Ollama](https://ollama.com), para modelos locales.

## Instalar en Windows 11

1. Bajá `Trama-Setup-<versión>.exe` de la página de Releases del repositorio y ejecutalo.
2. Abrí Trama desde el menú Inicio: corre nativo en Windows (sin WSL), con `pa`, `tablero`, `cuentas` y
   `trama-estado` como `.cmd` que instala junto a la app.

## Modelos

Sin configurar nada, los workers usan Claude Sonnet con effort `high` (y `--tipo mecanico` va a Haiku). Para elegir modelo por tipo de
tarea, o para usar modelos locales de Ollama, escribí `~/.config/trama/modelos.json`:

```json
{
  "version": 1,
  "lider":   {"modelo": "claude-opus-5-5", "effort": "high"},
  "workers": {
    "default":  {"modelo": "claude-sonnet-5-5", "effort": "high"},
    "mecanico": {"modelo": "ollama:qwen3-coder:30b"}
  },
  "locales": [
    {"id": "ollama:qwen3-coder:30b", "nombre": "Qwen3 Coder 30B",
     "url": "http://localhost:11434", "modelo": "qwen3-coder:30b"}
  ],
  "gemini": {"cupo_max": 70, "sin_claude": "claude"}
}
```

- `workers.<tipo>` elige modelo y effort de `pa --tipo <tipo>` (sin `-m`); lo que no está cae en `default`.
- `ollama:<modelo>` usa el servidor de `url` (por default `http://localhost:11434`). Las variables de
  Ollama se pasan sólo al proceso de ese worker.
- Si el archivo no valida, `pa` lo avisa en una línea y sigue con los modelos de fábrica.
- `pa --modelos` muestra qué modelo y effort va a usar cada tipo.

## Licencia

Trama se distribuye bajo licencia MIT (ver `LICENSE`). Los componentes de terceros y sus licencias están en
`app/THIRD_PARTY.md`.
