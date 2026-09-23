import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const sourceDir = new URL('../src/', import.meta.url);
const outputDir = new URL('../public/', import.meta.url);
const page = await readFile(new URL('index.php', sourceDir), 'utf8');
const about = await readFile(new URL('lang/en-us.php', sourceDir), 'utf8');
const language = await readFile(new URL('lang/en-us.js', sourceDir), 'utf8');

const languageBootstrap = `<meta name="keywords" content="timer, cstimer, rubiks cube timer, online timer, web timer">
  <title> csTimer - Professional Rubik's Cube Speedsolving/Training Timer </title>
  <script type="text/javascript">
var CSTIMER_VERSION = 'cloudflare-pages';
var LANG_SET = '|en-us|ar-sa|bn-bd|ca-es|cs-cz|da-dk|de-de|el-gr|es-es|fa-ir|fi-fi|fr-fr|he-il|hi-in|hr-hr|hu-hu|it-it|ja-jp|ko-kr|lv-lv|nl-nl|no-no|pl-pl|pt-pt|ro-ro|ru-ru|sk-sk|sl-si|sr-sp|sv-se|tr-tr|uk-ua|vi-vn|zh-cn|zh-tw';
var LANG_STR = 'English|العربية|বাংলা|Català|Čeština|Dansk|Deutsch|Ελληνικά|Español|فارسی|Suomi|Français|עברית|हिन्दी|Hrvatski|Magyar|Italiano|日本語|한국어|Latviešu|Nederlands|Norsk|Polski|Português|Română|Pусский|Slovenčina|Slovenski|Српски|Svenska|Türkçe|Українська|Tiếng Việt|简体中文|繁體中文';
var LANG_CUR = 'en-us';
${language}
  </script>`;

const html = page
  .replace("<?php include('lang/langDet.php');?>", languageBootstrap)
  .replace("<?php include('lang/'.$lang.'.php') ?>", about);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });
await writeFile(new URL('index.html', outputDir), html);
