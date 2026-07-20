import { readFile, writeFile } from 'node:fs/promises'

const cnameUrl = new URL('../dist/CNAME', import.meta.url)
const noJekyllUrl = new URL('../dist/.nojekyll', import.meta.url)
const cname = (await readFile(cnameUrl, 'utf8')).trim()

if (cname !== 'jibunq.com') {
  throw new Error(`Unexpected CNAME: ${cname || '(empty)'}`)
}

await writeFile(noJekyllUrl, '')
