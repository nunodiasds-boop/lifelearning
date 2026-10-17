#!/usr/bin/env node
// Copia do cofre do Obsidian para content/ apenas as notas com `publish: true`,
// e só os anexos que essas notas usam. Nunca toca em 07 Privado nem 00 Inbox.
//
// Uso (a partir da pasta do repositório):
//   node scripts/publicar.mjs            copia para content/ e mostra o relatório
//   node scripts/publicar.mjs --ver      só mostra o que seria publicado
//   node scripts/publicar.mjs --enviar   copia, faz commit de content/ e push
//   node scripts/publicar.mjs --cofre "/caminho/para/o/cofre"
//
// O cofre por omissão é a pasta Lifelearning do Obsidian no iCloud.
// Também pode vir da variável de ambiente LIFELEARNING_COFRE.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONTENT = path.join(REPO, "content")

const args = process.argv.slice(2)
const opt = (name) => args.includes(name)
const val = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const COFRE = path.resolve(
  (
    val("--cofre") ??
    process.env.LIFELEARNING_COFRE ??
    path.join(os.homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/Lifelearning")
  ).replace(/^~(?=\/)/, os.homedir()),
)
const SO_VER = opt("--ver")
const ENVIAR = opt("--enviar")

// Pastas que nunca saem, aconteça o que acontecer.
const PROIBIDAS = [
  "07 Privado",
  "00 Inbox",
  "90 Anexos/Modelos de nota",
  "91 conteudo", // documentos do currículo e soluções dos problemas
  "92 Recursos", // PDFs e livros com direitos de autor
]
// Nome público de cada pasta (URLs limpos).
const MAPA = {
  "01 Temas": { pasta: "temas", titulo: "Temas" },
  "02 Modelos": { pasta: "modelos", titulo: "Modelos mentais" },
  "03 Projetos": { pasta: "projetos", titulo: "Projetos" },
  "04 Corpo": { pasta: "corpo", titulo: "Corpo" },
  "05 Fontes": { pasta: "fontes", titulo: "Fontes" },
  "06 Pactos": { pasta: "pactos", titulo: "Pactos" },
}
const EXT_ANEXO = /\.(png|jpe?g|gif|webp|svg|avif|pdf|mp4|webm|mov|mp3|m4a)$/i

const avisos = []
const erros = []
const rel = (p) => path.relative(COFRE, p).split(path.sep).join("/")
const proibido = (r) => PROIBIDAS.some((d) => r === d || r.startsWith(d + "/"))

if (!fs.existsSync(COFRE)) {
  console.error(
    `✗ Não encontro o cofre em:\n  ${COFRE}\nUsa --cofre "/caminho" ou LIFELEARNING_COFRE.`,
  )
  process.exit(1)
}

// ---------- Ler o cofre ----------
function percorrer(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue // .obsidian, .trash, .DS_Store
    const p = path.join(dir, e.name)
    if (e.isDirectory()) percorrer(p, out)
    else out.push(p)
  }
  return out
}
const todos = percorrer(COFRE)

function frontmatter(txt) {
  const m = txt.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const campos = {}
  if (!m) return campos
  for (const linha of m[1].split(/\r?\n/)) {
    const k = linha.match(/^([A-Za-zÀ-ÿ0-9_-]+):\s*(.*)$/)
    if (k)
      campos[k[1].toLowerCase()] = k[2]
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase()
  }
  return campos
}
const verdadeiro = (v) => ["true", "yes", "sim"].includes(v ?? "")

const notas = todos.filter((p) => p.toLowerCase().endsWith(".md"))
const nomeNota = (p) => path.basename(p, path.extname(p)).toLowerCase()

// Índice de todas as notas (para avisar sobre ligações a notas não publicadas).
const indice = new Map() // nome → { publicada, privada, rel }
const publicar = []
for (const p of notas) {
  const r = rel(p)
  const txt = fs.readFileSync(p, "utf8")
  const fm = frontmatter(txt)
  const quer = verdadeiro(fm.publish)
  const privada = proibido(r) || fm.tipo === "privado"
  let ok = quer && !privada
  if (quer && privada) erros.push(`${r}: tem publish: true mas é privada. Não publicada.`)
  indice.set(nomeNota(p), { publicada: ok, privada: proibido(r) || fm.tipo === "privado", rel: r })
  if (ok) publicar.push({ p, r, txt, fm })
}

// ---------- Destino de cada nota ----------
function destino({ r, fm }) {
  if (fm.site === "inicio") return "index.md"
  const partes = r.split("/")
  const topo = MAPA[partes[0]]
  if (topo) return [topo.pasta, ...partes.slice(1)].join("/")
  if (partes[0] === "90 Anexos") return ["anexos", ...partes.slice(1)].join("/")
  return r
}

// ---------- Ligações e anexos ----------
const anexosPorNome = new Map()
for (const p of todos) {
  if (!EXT_ANEXO.test(p)) continue
  const nome = path.basename(p).toLowerCase()
  if (!anexosPorNome.has(nome)) anexosPorNome.set(nome, [])
  anexosPorNome.get(nome).push(p)
}

const anexos = new Map() // caminho no cofre → caminho em content/
for (const n of publicar) {
  const semCodigo = n.txt.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "")
  // [[alvo]] ou ![[alvo|...]] ou [[alvo#secção]]
  for (const m of semCodigo.matchAll(/(!?)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const alvo = m[2].trim()
    const base = path.basename(alvo)
    if (EXT_ANEXO.test(base)) {
      juntarAnexo(n, base)
      continue
    }
    const info = indice.get(base.replace(/\.md$/i, "").toLowerCase())
    if (!info) continue // nota ainda não criada: o Quartz mostra a ligação sem destino
    if (info.privada)
      erros.push(`${n.r}: liga a uma nota privada ([[${alvo}]]). O título ficaria visível no site.`)
    else if (!info.publicada)
      avisos.push(`${n.r}: liga a [[${alvo}]], que ainda não está publicada.`)
  }
  // ![texto](caminho.png)
  for (const m of semCodigo.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const alvo = decodeURIComponent(m[1])
    if (/^[a-z]+:\/\//i.test(alvo)) continue
    if (EXT_ANEXO.test(alvo)) juntarAnexo(n, path.basename(alvo))
  }
}
function juntarAnexo(n, base) {
  const candidatos = (anexosPorNome.get(base.toLowerCase()) ?? []).filter((p) => !proibido(rel(p)))
  if (candidatos.length === 0) {
    const existePrivado = (anexosPorNome.get(base.toLowerCase()) ?? []).length > 0
    ;(existePrivado ? erros : avisos).push(
      existePrivado
        ? `${n.r}: usa ${base}, que só existe numa pasta privada. Não copiado.`
        : `${n.r}: usa ${base}, que não encontro no cofre.`,
    )
    return
  }
  anexos.set(candidatos[0], path.join("anexos", path.basename(candidatos[0])))
}

// ---------- Relatório ----------
console.log(`Cofre: ${COFRE}`)
console.log(`\nNotas a publicar (${publicar.length}):`)
for (const n of publicar) console.log(`  ${n.r}  →  content/${destino(n)}`)
console.log(`\nAnexos a copiar (${anexos.size}):`)
for (const [de, para] of anexos)
  console.log(`  ${rel(de)}  →  content/${para.split(path.sep).join("/")}`)
if (avisos.length) console.log(`\nAvisos:\n  - ${avisos.join("\n  - ")}`)
if (erros.length) console.log(`\nProblemas de privacidade:\n  ✗ ${erros.join("\n  ✗ ")}`)

if (!publicar.some((n) => destino(n) === "index.md"))
  erros.push("Falta a página inicial: uma nota com `site: inicio` e `publish: true` (Sobre.md).")

if (erros.length) {
  console.error(`\n✗ Nada foi copiado. Corrige os problemas acima e volta a correr.`)
  process.exit(1)
}
if (SO_VER) {
  console.log("\n(--ver: nada foi copiado)")
  process.exit(0)
}

// ---------- Copiar ----------
// Limpa content/ (só dentro do repositório) e volta a escrever tudo.
if (!CONTENT.startsWith(REPO + path.sep)) throw new Error("content/ fora do repositório")
for (const e of fs.readdirSync(CONTENT)) {
  if (e === ".gitkeep") continue
  fs.rmSync(path.join(CONTENT, e), { recursive: true, force: true })
}
const escrever = (destRel, dados) => {
  const d = path.join(CONTENT, destRel)
  fs.mkdirSync(path.dirname(d), { recursive: true })
  fs.writeFileSync(d, dados)
}
const pastasUsadas = new Set()
for (const n of publicar) {
  const d = destino(n)
  escrever(d, n.txt)
  const topo = d.split("/")[0]
  if (d.includes("/")) pastasUsadas.add(topo)
}
for (const [chave, { pasta, titulo }] of Object.entries(MAPA)) {
  if (pastasUsadas.has(pasta) && !fs.existsSync(path.join(CONTENT, pasta, "index.md")))
    escrever(path.join(pasta, "index.md"), `---\ntitle: ${titulo}\npublish: true\n---\n`)
}
for (const [de, para] of anexos) escrever(para, fs.readFileSync(de))
console.log(`\n✓ ${publicar.length} notas e ${anexos.size} anexos em content/.`)

// ---------- Enviar ----------
if (ENVIAR) {
  const git = (...a) => execFileSync("git", a, { cwd: REPO, stdio: "inherit" })
  git("add", "-A", "content")
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO })
    console.log("Sem alterações no site.")
  } catch {
    const data = new Date().toISOString().slice(0, 16).replace("T", " ")
    git("commit", "-m", `Publicar ${data}`)
    git("push")
    console.log("✓ Enviado. O site atualiza em 1 a 2 minutos.")
  }
}
