# Changelog

## [3.5.0](https://github.com/Nereziel/osobni-dochazka/compare/v3.4.0...v3.5.0) (2026-11-27)


### Features

* zaokrouhlení příchodů a odchodů na 5 minut ([#49](https://github.com/Nereziel/osobni-dochazka/issues/49)) ([00926c5](https://github.com/Nereziel/osobni-dochazka/commit/00926c510cae1f5c70fababf721141215e9e8d11))

## [3.4.0](https://github.com/Nereziel/osobni-dochazka/compare/v3.3.0...v3.4.0) (2026-11-27)


### Features

* doporučený odchod podle měsíčního salda ([#36](https://github.com/Nereziel/osobni-dochazka/issues/36)) ([b6d14b9](https://github.com/Nereziel/osobni-dochazka/commit/b6d14b940f58d70ed85ca6139b97eaac58d65d85))
* přehled a bezpečné řešení synchronizačních konfliktů ([#42](https://github.com/Nereziel/osobni-dochazka/issues/42)) ([cae1878](https://github.com/Nereziel/osobni-dochazka/commit/cae187838ee2365cd80d9ae8a02279386bced6cf))


### Bug Fixes

* atomické ukládání nastavení a kontrola účtu ([#45](https://github.com/Nereziel/osobni-dochazka/issues/45)) ([06725a7](https://github.com/Nereziel/osobni-dochazka/commit/06725a7723fe3939606642d369fd03500ed3d740))
* jednotný zdroj verze aplikace pro automatická vydání ([#48](https://github.com/Nereziel/osobni-dochazka/issues/48)) ([74f974c](https://github.com/Nereziel/osobni-dochazka/commit/74f974c508dfb83052c02ae66310480ab399473e))
* minimální oprávnění databázového API ([#39](https://github.com/Nereziel/osobni-dochazka/issues/39)) ([e0a466b](https://github.com/Nereziel/osobni-dochazka/commit/e0a466ba272a5bdfc0d876f87f12003b5e729d38))
* náhled zálohy a obnova pouze chybějících dnů ([#43](https://github.com/Nereziel/osobni-dochazka/issues/43)) ([7876cbc](https://github.com/Nereziel/osobni-dochazka/commit/7876cbc082d0e4345f285627cdd729278b9a6b72))
* ochrana neodeslané docházky při vypršení relace ([#38](https://github.com/Nereziel/osobni-dochazka/issues/38)) ([4857956](https://github.com/Nereziel/osobni-dochazka/commit/4857956666f3e7726dbfebdfd1fc61e5a9194283))
* ochrana souběžné synchronizace ve více záložkách ([#46](https://github.com/Nereziel/osobni-dochazka/issues/46)) ([02af821](https://github.com/Nereziel/osobni-dochazka/commit/02af8216bb032075e7c982bb3e0a42f8734951d9))
* sjednocení týmového přehledu a výpočtů docházky ([#47](https://github.com/Nereziel/osobni-dochazka/issues/47)) ([f77ba3c](https://github.com/Nereziel/osobni-dochazka/commit/f77ba3c23ed7fad2eacab3f1b80b2423f6588566))
* uzavřené saldo, plánované dny a dovolená ([#41](https://github.com/Nereziel/osobni-dochazka/issues/41)) ([85571ae](https://github.com/Nereziel/osobni-dochazka/commit/85571ae3b7931c77d1bc07e3febaef67c8fd1b9a))
* validace a limity Cloudflare API ([#40](https://github.com/Nereziel/osobni-dochazka/issues/40)) ([ac8a190](https://github.com/Nereziel/osobni-dochazka/commit/ac8a1902b46a881082fee5f2f178ca761cbe00ee))
* zachování odmítnutých změn a pravdivý stav synchronizace ([#44](https://github.com/Nereziel/osobni-dochazka/issues/44)) ([aaa31b3](https://github.com/Nereziel/osobni-dochazka/commit/aaa31b3069173a32da8bcc49d609bb36b2428135))

## [3.3.0](https://github.com/Nereziel/osobni-dochazka/compare/v3.2.0...v3.3.0) (2026-11-18)


### Features

* add custom-time departure quick action ([#31](https://github.com/Nereziel/osobni-dochazka/issues/31)) ([b98136a](https://github.com/Nereziel/osobni-dochazka/commit/b98136a084272db690d5f2247bd018b99bbf2b7a))

## [3.2.0](https://github.com/Nereziel/osobni-dochazka/compare/v3.1.6...v3.2.0) (2026-11-18)


### Features

* selected-time quick arrival with build date refresh ([#30](https://github.com/Nereziel/osobni-dochazka/issues/30)) ([b82152c](https://github.com/Nereziel/osobni-dochazka/commit/b82152cb0fd33724cbb7d6202fc530ba5bf274fa))


### Bug Fixes

* doctor end-time and overnight attendance ([#22](https://github.com/Nereziel/osobni-dochazka/issues/22)) ([1e70a9e](https://github.com/Nereziel/osobni-dochazka/commit/1e70a9e898d1dcb17527e6005c33eaa645b4becd))
* persist attendance and sync queue atomically ([#23](https://github.com/Nereziel/osobni-dochazka/issues/23)) ([a691442](https://github.com/Nereziel/osobni-dochazka/commit/a69144214a260ac99bc971c522def7d614c9dfdc))
* preserve doctor appointments and show ongoing manual shifts ([#20](https://github.com/Nereziel/osobni-dochazka/issues/20)) ([a466114](https://github.com/Nereziel/osobni-dochazka/commit/a466114d70a732c3443e0a9200dc553b8a07d930))
* validate and atomically merge attendance backup ([#24](https://github.com/Nereziel/osobni-dochazka/issues/24)) ([7ebf2f1](https://github.com/Nereziel/osobni-dochazka/commit/7ebf2f114271202bb40b3dc4199217375550be79))

## [3.1.6](https://github.com/Nereziel/osobni-dochazka/compare/v3.1.5...v3.1.6) (2026-11-03)


### Bug Fixes

* pin npm version for Cloudflare builds ([cf9f650](https://github.com/Nereziel/osobni-dochazka/commit/cf9f650f4e456e219b3046be8fc3768b1f533e1e))
* remove vulnerable PWA build dependencies ([#17](https://github.com/Nereziel/osobni-dochazka/issues/17)) ([eef56b6](https://github.com/Nereziel/osobni-dochazka/commit/eef56b6a5541131d7cd991c8c6482b4988b66d12))

## [3.1.5](https://github.com/Nereziel/osobni-dochazka/compare/v3.1.4...v3.1.5) (2026-11-03)


### Bug Fixes

* remove URL-controlled registration branch ([c3c07b8](https://github.com/Nereziel/osobni-dochazka/commit/c3c07b81582f2074375a6cc708f1c173756ecbd4))

## [3.1.4](https://github.com/Nereziel/osobni-dochazka/compare/v3.1.3...v3.1.4) (2026-11-03)


### Bug Fixes

* add automated release versioning ([da9cd8e](https://github.com/Nereziel/osobni-dochazka/commit/da9cd8ea7d8270645d7c87bf74fe0700827d5575))
