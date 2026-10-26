import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { alCambiarTiernos, cambiarTiernos, CARAS, FRASES, formato, fraseIdx, pintorTierno, ritmo, textoTierno, tiernos } from "../src/hilo/tierno-datos.ts";

const SEMILLAS = ["20261003-100100-11111", "20261003-100200-22222", "00000000-0000-4000-8000-000000000001", "a", ""];

const largo = (s: string) => [...s].length;

/** Si `s` es algo que puede decir: frase, frase y carita, o carita sola. */
function esTierno(s: string, d: Record<string, string>) {
  const frases = new Set(FRASES.map((k) => d[k]));
  const caras = new Set(CARAS.map((k) => d[k]));
  if (frases.has(s) || caras.has(s)) return true;
  const i = s.lastIndexOf(" ");
  return i > 0 && frases.has(s.slice(0, i)) && caras.has(s.slice(i + 1));
}

test("al menos 80 frases por idioma, sin repetidas, y frase + carita entran en 28 caracteres", () => {
  assert.ok(FRASES.length >= 80, String(FRASES.length));
  assert.ok(CARAS.length >= 15, String(CARAS.length));
  for (const d of [en, es]) {
    assert.equal(new Set(FRASES.map((k) => d[k])).size, FRASES.length);
    assert.equal(new Set(CARAS.map((k) => d[k])).size, CARAS.length);
    const frase = Math.max(...FRASES.map((k) => largo(d[k])));
    const cara = Math.max(...CARAS.map((k) => largo(d[k])));
    assert.ok(frase + 1 + cara <= 28, `${frase} + ${cara}`);
  }
  // Las caritas no se traducen.
  for (const k of CARAS) assert.equal(es[k], en[k]);
});

test("ninguna frase trae carita (la pone el formato) ni es una carita", () => {
  for (const d of [en, es]) {
    const caras = CARAS.map((k) => d[k]);
    for (const k of FRASES) {
      const f = d[k];
      assert.ok(!caras.some((c) => f === c || f.endsWith(` ${c}`)), `${k}: ${f}`);
    }
  }
});

test("los formatos con azar sembrado: 60 % frase y carita, 20 % sólo frase, 20 % sólo carita", () => {
  for (const s of SEMILLAS) {
    const n = 6000;
    const cuenta = { ambas: 0, frase: 0, cara: 0 };
    for (let paso = 0; paso < n; paso++) cuenta[formato(s, paso)]++;
    assert.ok(Math.abs(cuenta.ambas / n - 0.6) < 0.03, `${s}: ${JSON.stringify(cuenta)}`);
    assert.ok(Math.abs(cuenta.frase / n - 0.2) < 0.03, `${s}: ${JSON.stringify(cuenta)}`);
    assert.ok(Math.abs(cuenta.cara / n - 0.2) < 0.03, `${s}: ${JSON.stringify(cuenta)}`);
    // Repetible: la misma semilla y el mismo paso dan siempre lo mismo.
    assert.equal(formato(s, 1234), formato(s, 1234));
  }
});

test("el texto sigue su formato y nunca repite el anterior", () => {
  for (const s of SEMILLAS) {
    let antes = textoTierno(s, -1);
    for (let paso = 0; paso < 2000; paso++) {
      const x = textoTierno(s, paso);
      assert.ok(esTierno(x, en), `${s} paso ${paso}: ${x}`);
      assert.ok(largo(x) <= 28, x);
      const f = formato(s, paso);
      const caras = CARAS.map((k) => en[k]);
      if (f === "cara") assert.ok(caras.includes(x), x);
      else if (f === "frase") assert.ok(FRASES.some((k) => en[k] === x), x);
      else assert.ok(caras.some((c) => x.endsWith(` ${c}`)), x);
      assert.notEqual(x, antes, `${s} paso ${paso}`);
      antes = x;
    }
  }
});

test("nunca sale la misma frase dos veces seguidas", () => {
  for (const s of SEMILLAS)
    for (const n of [2, 3, 7, FRASES.length]) {
      let antes = fraseIdx(s, -1, n);
      for (let paso = 0; paso < n * 60; paso++) {
        const i = fraseIdx(s, paso, n);
        assert.ok(i >= 0 && i < n, `${s} n=${n} paso=${paso}: ${i}`);
        assert.notEqual(i, antes, `${s} n=${n} paso=${paso}`);
        antes = i;
      }
    }
  assert.equal(fraseIdx("a", 5, 1), 0);
});

test("cada vuelta pasa por todas las frases", () => {
  const n = FRASES.length;
  for (const s of SEMILLAS)
    for (const vuelta of [0, 1, 17]) {
      const vistas = new Set(Array.from({ length: n }, (_, i) => fraseIdx(s, vuelta * n + i, n)));
      assert.equal(vistas.size, n, `${s} vuelta ${vuelta}`);
    }
});

test("cada semilla tiene su ritmo: de 4 a 6 s, y no todas el mismo", () => {
  const ritmos = SEMILLAS.map(ritmo);
  for (const r of ritmos) {
    assert.ok(r.periodo >= 4 && r.periodo <= 6, String(r.periodo));
    assert.ok(r.desfase >= 0 && r.desfase < r.periodo, String(r.desfase));
  }
  assert.ok(new Set(ritmos.map((r) => r.periodo)).size > 1);
});

test("el pintor: una frase del idioma de ahora, cambia sola y alterna data-par", () => {
  const p = pintorTierno(SEMILLAS[0], () => "Working");
  let t = 1_800_000_000;
  let antes = p(t);
  assert.ok(esTierno(antes.texto, en), antes.texto);
  for (let i = 0; i < 80; i++) {
    assert.ok(antes.en > 0 && antes.en <= 6, String(antes.en));
    // Un pelo antes del cambio sigue igual; al cambio, otra frase y el otro `data-par`.
    assert.equal(p(t + antes.en - 0.001).texto, antes.texto);
    t += antes.en + 0.02;
    const ahora = p(t);
    assert.ok(esTierno(ahora.texto, en), ahora.texto);
    assert.notEqual(ahora.texto, antes.texto);
    assert.notEqual(ahora.attrs?.["data-par"], antes.attrs?.["data-par"]);
    antes = ahora;
  }
  cambiarIdioma("es");
  try {
    assert.ok(esTierno(p(t).texto, es), p(t).texto);
  } finally {
    cambiarIdioma("en");
  }
});

test("apagados: dice lo de siempre, no rota, y el cambio avisa una vez", () => {
  const p = pintorTierno(SEMILLAS[1], () => "Working");
  let avisos = 0;
  const soltar = alCambiarTiernos(() => avisos++);
  assert.equal(tiernos(), true);
  cambiarTiernos(false);
  try {
    assert.equal(tiernos(), false);
    for (const t of [0, 1_800_000_000, 1_800_000_005.5, 1_800_000_011]) {
      const x = p(t);
      assert.equal(x.texto, "Working");
      assert.equal(x.en, Infinity);
      assert.equal(x.attrs?.["data-par"], null);
    }
    cambiarTiernos(false);
    assert.equal(avisos, 1);
  } finally {
    cambiarTiernos(true);
    soltar();
  }
  assert.equal(avisos, 2);
  assert.notEqual(p(1_800_000_000).texto, "Working");
});
