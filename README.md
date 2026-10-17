# Lifelearning

Site público do currículo _Mapa e Território_, feito com [Quartz 5](https://quartz.jzhao.xyz) e publicado no GitHub Pages.

O cofre do Obsidian **não vive aqui**: está no iCloud. Este repositório só recebe as notas que o script `scripts/publicar.mjs` copia, e por isso pode ser público.

## Publicar

```bash
cd ~/lifelearning
npm run publicar:ver      # mostra o que vai sair, sem copiar nada
npm run publicar          # copia para content/
npm run site              # pré-visualização em http://localhost:8080
npm run publicar:enviar   # copia, faz commit de content/ e envia; o site atualiza em 1-2 min
```

## Regras do script

- Só copia notas com `publish: true`.
- Nunca copia nada de `07 Privado`, `00 Inbox` nem dos modelos de nota, e recusa notas com `tipo: privado`.
- Para tudo, sem copiar nada, se uma nota pública ligar a uma nota privada ou usar uma imagem que só existe numa pasta privada.
- Copia só os anexos que as notas publicadas usam (o Quartz publicaria qualquer ficheiro que estivesse em `content/`).
- A página inicial é a nota com `site: inicio` (o `Sobre.md` do cofre).
- As pastas ganham nomes limpos no site: `01 Temas` → `temas`, `02 Modelos` → `modelos`, etc.
- O cofre por omissão é `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lifelearning`. Para outro sítio: `npm run publicar -- --cofre "/caminho"`.

A segunda barreira está no `quartz.config.yaml`: o plugin `explicit-publish` só deixa passar notas com `publish: true`, e `ignorePatterns` ignora `07 Privado` e `00 Inbox`.
