# Changelog

All notable changes to ComplyEaze Pack are documented here.

## Unreleased

## [0.6.0](https://github.com/lamemustafa/pack/compare/v0.5.1...v0.6.0) (2026-09-12)


### Features

* **design:** add the design contract, capability table, and Phase A panel ([#169](https://github.com/lamemustafa/pack/issues/169)) ([f4b0d3b](https://github.com/lamemustafa/pack/commit/f4b0d3b16a1b25bab5ff24caaf24d011a922d7bf))
* **filed-returns:** add all-supported fiscal-year runner ([#243](https://github.com/lamemustafa/pack/issues/243)) ([68b7ad5](https://github.com/lamemustafa/pack/commit/68b7ad525b8ac75f0f8e8bb4e9ac06f9fd838ab9))
* **filed-returns:** reconcile catalogue-driven recovery plan ([#239](https://github.com/lamemustafa/pack/issues/239)) ([188de14](https://github.com/lamemustafa/pack/commit/188de1454bef8fcdd064ccec33e1b0a4437d8fa9))
* **gst:** add an ITC summary sheet and a reconciliation key to the GSTR-2B workbook ([#199](https://github.com/lamemustafa/pack/issues/199)) ([9ef47cb](https://github.com/lamemustafa/pack/commit/9ef47cba2bfc70cc700c6b919404f76ba5bfe05b))
* **gst:** add GSTR-2B invoice workbook ([#196](https://github.com/lamemustafa/pack/issues/196)) ([ceb6ada](https://github.com/lamemustafa/pack/commit/ceb6adaa35346c97f8402998a59268e3a74cccdb))
* **panel:** gate full-year source surfaces ([#246](https://github.com/lamemustafa/pack/issues/246)) ([1a15762](https://github.com/lamemustafa/pack/commit/1a157628e2da6c05ceff0e9a450b29061af892e2))
* **panel:** open the side panel from the action and fold the popup in ([#189](https://github.com/lamemustafa/pack/issues/189)) ([6ee8f5b](https://github.com/lamemustafa/pack/commit/6ee8f5b1236b8b37130dd60b7b7a88fa2094767f))
* **panel:** prioritize complete-year recipe ([#258](https://github.com/lamemustafa/pack/issues/258)) ([649bb80](https://github.com/lamemustafa/pack/commit/649bb80658bbb58ac68ae82a2ab5dadf59ec7607))
* **panel:** quiet presets and show run progress ([#259](https://github.com/lamemustafa/pack/issues/259)) ([d9bfb4f](https://github.com/lamemustafa/pack/commit/d9bfb4f4e9f557c7eb0b6bf6be2c30abb1fee0e1))
* **panel:** record why cleanup happened and what a period actually got ([#212](https://github.com/lamemustafa/pack/issues/212)) ([ec29528](https://github.com/lamemustafa/pack/commit/ec29528b33456c166c5c3e6b1150ee2dbe2621f9))
* **panel:** restart completed all-supported plans ([#261](https://github.com/lamemustafa/pack/issues/261)) ([0490a51](https://github.com/lamemustafa/pack/commit/0490a51f82080e2fdb01a75657c424defa01fc80))
* **panel:** show what Pack can prove for each period ([#207](https://github.com/lamemustafa/pack/issues/207)) ([f615c1c](https://github.com/lamemustafa/pack/commit/f615c1c11e5fc19cb1c06c3c48a10c43e80d1210))
* **summary:** add full-year workbook ([#145](https://github.com/lamemustafa/pack/issues/145)) ([4c291a1](https://github.com/lamemustafa/pack/commit/4c291a1e09580f7c85fc930feb39e931be8b8634))


### Fixes

* **background:** prefer newer ordinary completion ([#266](https://github.com/lamemustafa/pack/issues/266)) ([7d11d7f](https://github.com/lamemustafa/pack/commit/7d11d7f45c4ff343fa4af7670ed0be0c48a0948d))
* **build:** disable module preload hints ([#155](https://github.com/lamemustafa/pack/issues/155)) ([3a46db9](https://github.com/lamemustafa/pack/commit/3a46db9d16431b795816cf6b77ae1c7ead48ba74))
* **build:** make the alpha build a production build ([#260](https://github.com/lamemustafa/pack/issues/260)) ([b0d03bc](https://github.com/lamemustafa/pack/commit/b0d03bc83aba52586e638f06c12e3c484bbb3448))
* **ci:** decouple Chrome Web Store submission from the release pipeline ([#338](https://github.com/lamemustafa/pack/issues/338)) ([336d257](https://github.com/lamemustafa/pack/commit/336d257095ca2b7d42d99f2621584e5429a23fb3))
* **ci:** fail closed on incomplete review evaluation ([#147](https://github.com/lamemustafa/pack/issues/147)) ([677f231](https://github.com/lamemustafa/pack/commit/677f231673201986d3c8b1ff439a15337eebda6a))
* **ci:** pass Store dispatch inputs as literal arguments ([#358](https://github.com/lamemustafa/pack/issues/358)) ([c5df536](https://github.com/lamemustafa/pack/commit/c5df53634ac8a1479779d53bdeb5c65507c5209f))
* **ci:** retain deleted review findings ([#238](https://github.com/lamemustafa/pack/issues/238)) ([164005e](https://github.com/lamemustafa/pack/commit/164005e6c43a0f1a09736ecdb48cab3f4f1940ca))
* **deps:** raise the js-yaml floor past GHSA-2883-xcg3-v3hh ([#344](https://github.com/lamemustafa/pack/issues/344)) ([d59a16e](https://github.com/lamemustafa/pack/commit/d59a16e3d321667d2280aaa0f5b0b5a8917f3115))
* **deps:** resolve browserslist past the prototype-write advisories ([#277](https://github.com/lamemustafa/pack/issues/277)) ([b81d2b6](https://github.com/lamemustafa/pack/commit/b81d2b69cc48b05ecac39bc4af6b8dbf16680f90))
* **filed-returns:** complete full-year terminal outcomes ([#300](https://github.com/lamemustafa/pack/issues/300)) ([11eb351](https://github.com/lamemustafa/pack/commit/11eb351c70f622e4182856b77261976a38ac679e))
* **filed-returns:** re-land bounded acquisition safety ([#312](https://github.com/lamemustafa/pack/issues/312)) ([1b64fab](https://github.com/lamemustafa/pack/commit/1b64fabde99870bf6c21e6118576f7152f65c9f5))
* **filed-returns:** simplify selection and completion paths ([#304](https://github.com/lamemustafa/pack/issues/304)) ([b78b13d](https://github.com/lamemustafa/pack/commit/b78b13d621dd6c12df147b9531d4ab5ee639f98d))
* **flow:** keep the workbook-only signal in durable state ([#201](https://github.com/lamemustafa/pack/issues/201)) ([cd3a4db](https://github.com/lamemustafa/pack/commit/cd3a4db4b1bdab2a93e92a75fe94446f5cbcc666))
* **gst:** close four GSTR-2B correctness gaps from post-merge review ([#210](https://github.com/lamemustafa/pack/issues/210)) ([9218160](https://github.com/lamemustafa/pack/commit/92181600d58dde060ccbbe18a34eef6d709ad97d))
* **gst:** defer current-year filed periods ([#294](https://github.com/lamemustafa/pack/issues/294)) ([e3a144e](https://github.com/lamemustafa/pack/commit/e3a144eb9025ef1c3204a2bee86eb918687a61bd))
* **gst:** normalise JSON number tokens before judging them ([#198](https://github.com/lamemustafa/pack/issues/198)) ([675b119](https://github.com/lamemustafa/pack/commit/675b119d5e0106bd51ba3a71258313e4a4462487))
* **gst:** refuse totals for unreadable periods ([#185](https://github.com/lamemustafa/pack/issues/185)) ([b947542](https://github.com/lamemustafa/pack/commit/b9475421315f82a51ff92eb8fb467d8a52645a0c))
* **gst:** scope summary identities to the return owner ([#184](https://github.com/lamemustafa/pack/issues/184)) ([599a09d](https://github.com/lamemustafa/pack/commit/599a09d214ec72952ee93743ce42225dbe46b480))
* **panel:** clarify blocked and restart plans ([#293](https://github.com/lamemustafa/pack/issues/293)) ([2686207](https://github.com/lamemustafa/pack/commit/26862079711bd7461d9d66bd358f442035eccfca))
* **panel:** close deferred panel defects from the panel lane ([#186](https://github.com/lamemustafa/pack/issues/186)) ([6cb4f58](https://github.com/lamemustafa/pack/commit/6cb4f588af744d354d745c5bcd71baf7a7767140))
* **panel:** disclose all-supported run diagnostics ([#296](https://github.com/lamemustafa/pack/issues/296)) ([090cd1c](https://github.com/lamemustafa/pack/commit/090cd1ce6de67d2cbf9110e06ed18c84fe0f777a))
* **panel:** stop the recipe cards reading as warnings ([#256](https://github.com/lamemustafa/pack/issues/256)) ([ae13bf2](https://github.com/lamemustafa/pack/commit/ae13bf210ef1444b046ccda4233ce876780c754b))
* **panel:** trim all-returns summary and catalogue ([#257](https://github.com/lamemustafa/pack/issues/257)) ([12302ce](https://github.com/lamemustafa/pack/commit/12302ce991f643c68e4d638d0c0d28936fd7da91))
* **popup:** require a reason for every portal-gated inline action ([#168](https://github.com/lamemustafa/pack/issues/168)) ([3dac81e](https://github.com/lamemustafa/pack/commit/3dac81eddfb4cb1ce39895bf0ee8f9c258eb469b))
* **popup:** stop claiming a ZIP was saved before any download is correlated ([#193](https://github.com/lamemustafa/pack/issues/193)) ([68f4c54](https://github.com/lamemustafa/pack/commit/68f4c54acf5ff0c17609e727cd8583b2aed7d82d))
* **popup:** stop gating local target-review retries on portal readiness ([#173](https://github.com/lamemustafa/pack/issues/173)) ([60543bf](https://github.com/lamemustafa/pack/commit/60543bf1bacac626ab6e6ad8d3e2abd5875fb277))
* **recovery:** keep withheld full-year guidance accurate ([#263](https://github.com/lamemustafa/pack/issues/263)) ([8de1d4b](https://github.com/lamemustafa/pack/commit/8de1d4b1e49334d2441b00547dcca69fbe586a08))
* **recovery:** name blocked target causes ([#157](https://github.com/lamemustafa/pack/issues/157)) ([e72438b](https://github.com/lamemustafa/pack/commit/e72438b3439a0c18a20424cce54fdc1e587b1078))
* **recovery:** preserve partial component proof ([#241](https://github.com/lamemustafa/pack/issues/241)) ([1a74c3a](https://github.com/lamemustafa/pack/commit/1a74c3a6087fbac425212cea95e9bcf0c73cb08d))
* **recovery:** reject incompatible checkpoints ([#242](https://github.com/lamemustafa/pack/issues/242)) ([273bcc6](https://github.com/lamemustafa/pack/commit/273bcc6da2b9954e59bc0d168df52ab1e2542f2d))
* **recovery:** restore initial observing summary outcomes ([#233](https://github.com/lamemustafa/pack/issues/233)) ([edad122](https://github.com/lamemustafa/pack/commit/edad122e61914e8a88e93c00e50f4449bbc8a2c5))
* **recovery:** retain all-supported plan provenance ([#280](https://github.com/lamemustafa/pack/issues/280)) ([42f35e4](https://github.com/lamemustafa/pack/commit/42f35e411f36928ec455a61cf3d6bb12b385fa96))
* **recovery:** retain the pre-search timeout reason after reload ([#317](https://github.com/lamemustafa/pack/issues/317)) ([3672d12](https://github.com/lamemustafa/pack/commit/3672d12f95361a21614a63ea53003f8c4ddd488f))
* **recovery:** retry reviewed all-supported target ([#264](https://github.com/lamemustafa/pack/issues/264)) ([14b7cec](https://github.com/lamemustafa/pack/commit/14b7cec357b40c3bb4f1be23c17e4dd3b10ac89e))
* **recovery:** surface malformed plan index ([#283](https://github.com/lamemustafa/pack/issues/283)) ([2d76390](https://github.com/lamemustafa/pack/commit/2d76390e419009caabdbc67f9d5bf7c5c5f71161))
* **release:** unblock the v0.6.0 release and bind public version copy ([#341](https://github.com/lamemustafa/pack/issues/341)) ([ff9b505](https://github.com/lamemustafa/pack/commit/ff9b50569b071f75877858e8ee55de9d41cb6eb2))
* **review-gate:** recover prior heads a force-push names but does not record ([#349](https://github.com/lamemustafa/pack/issues/349)) ([d3d66a0](https://github.com/lamemustafa/pack/commit/d3d66a043ec8b64f5a532d4b7a7c58b18466e4fa))
* **review-gate:** recover untraceable force-pushes ([#318](https://github.com/lamemustafa/pack/issues/318)) ([4527569](https://github.com/lamemustafa/pack/commit/4527569f93fe3b501d174d54d9c5ff383bca85aa))
* **review-gate:** require strict current-head review ([#216](https://github.com/lamemustafa/pack/issues/216)) ([78b74d1](https://github.com/lamemustafa/pack/commit/78b74d117e63cdaf4aba1d70a1431ba546e21bf0))
* **review-gate:** scope the durable-state search to heads that can carry it ([#351](https://github.com/lamemustafa/pack/issues/351)) ([26eeb7c](https://github.com/lamemustafa/pack/commit/26eeb7cc59c8c661c3fa7dc8fb5a431c8aa48dd4))
* **summary:** identify CSV financial year ([#214](https://github.com/lamemustafa/pack/issues/214)) ([dbcd0cb](https://github.com/lamemustafa/pack/commit/dbcd0cbcf282cda8ac2658de3f918c2533811b7b))
* **tests:** typecheck .tsx test files under tsc ([#176](https://github.com/lamemustafa/pack/issues/176)) ([a477b4b](https://github.com/lamemustafa/pack/commit/a477b4b812a044a038ed91ae3c009733abf667fe)), refs [#174](https://github.com/lamemustafa/pack/issues/174)
* **verifier:** parse packaged HTML references ([#319](https://github.com/lamemustafa/pack/issues/319)) ([9f6ec17](https://github.com/lamemustafa/pack/commit/9f6ec17a0ca4b8d4a9c5f1510582553635aae5d5))
* **workbook:** show the decimals a value actually has ([#213](https://github.com/lamemustafa/pack/issues/213)) ([01e3582](https://github.com/lamemustafa/pack/commit/01e3582f76cdd9e9829c81adfaa227f05f5cbd97))


### Documentation

* **agents:** bind policy review to its source ([#305](https://github.com/lamemustafa/pack/issues/305)) ([535294f](https://github.com/lamemustafa/pack/commit/535294f76e946e63a5ef7318a45af16e2072b6ed))
* **governance:** clarify portal landing navigation ([#182](https://github.com/lamemustafa/pack/issues/182)) ([2a861f5](https://github.com/lamemustafa/pack/commit/2a861f5439029dc2c2eb535054e7c3ae52106c5e))
* **governance:** drop unenforced DCO requirement ([#229](https://github.com/lamemustafa/pack/issues/229)) ([dce1142](https://github.com/lamemustafa/pack/commit/dce1142af3ede3519d71727bb2b455879587503d))
* **governance:** require disposition for every review ask ([#162](https://github.com/lamemustafa/pack/issues/162)) ([8d55cf1](https://github.com/lamemustafa/pack/commit/8d55cf1f1d8d9aad425a4a32f9390b49c98eea96))
* **gst:** record filing-profile discovery hold ([#302](https://github.com/lamemustafa/pack/issues/302)) ([c039151](https://github.com/lamemustafa/pack/commit/c03915156e1aa14ddf8c6cd37ec967c9bb9d6e52))
* **readiness:** record v0.5.0 as published and bring GSTR-2B into scope ([#188](https://github.com/lamemustafa/pack/issues/188)) ([e50161b](https://github.com/lamemustafa/pack/commit/e50161bf9d4f5a722987c653af22bbb87e059438))
* **repo:** record autonomous session evidence ([#230](https://github.com/lamemustafa/pack/issues/230)) ([20f9a70](https://github.com/lamemustafa/pack/commit/20f9a70e0795c16aa81e2c2a0459b4625ba48529))
* **session:** close validation ledger ([#237](https://github.com/lamemustafa/pack/issues/237)) ([0d9fbf2](https://github.com/lamemustafa/pack/commit/0d9fbf2f4dba2fa767471fc9851b380a4db27875))
* **session:** record autonomous validation evidence ([#236](https://github.com/lamemustafa/pack/issues/236)) ([3a8bc4b](https://github.com/lamemustafa/pack/commit/3a8bc4b0cd5c92f107b8238f324b4e90b33b3c24))
* **session:** record verified overnight progress and blockers ([#235](https://github.com/lamemustafa/pack/issues/235)) ([19271b8](https://github.com/lamemustafa/pack/commit/19271b8791addd918fc26564c2b4fadd54b6907f))
* **store:** clarify supported GST downloads ([#292](https://github.com/lamemustafa/pack/issues/292)) ([6c37566](https://github.com/lamemustafa/pack/commit/6c375662fcf2445bdb3907f580c6a18d4d8dd81d))
* **store:** correct the listing to the published beta and GSTR-2B scope ([#192](https://github.com/lamemustafa/pack/issues/192)) ([8bdcc39](https://github.com/lamemustafa/pack/commit/8bdcc39f2cc6fb032ba49b6cb69ba5f8b95fdb82))


### Tests

* **guards:** pin remaining audit guards ([#279](https://github.com/lamemustafa/pack/issues/279)) ([7c2faf5](https://github.com/lamemustafa/pack/commit/7c2faf5ee35104404a50019db3c3b1bf25631c79))
* **panel:** cover mixed all-supported evidence ([#265](https://github.com/lamemustafa/pack/issues/265)) ([781f951](https://github.com/lamemustafa/pack/commit/781f951e5da3e5c5e467c13ed4d3a8873b2e0e3e))
* **recovery:** enumerate withheld copy surfaces ([#272](https://github.com/lamemustafa/pack/issues/272)) ([9dd3450](https://github.com/lamemustafa/pack/commit/9dd3450b39b2c49984417d9772ce508521018695))
* **repo:** guard against unreferenced source modules ([#217](https://github.com/lamemustafa/pack/issues/217)) ([e3eaf40](https://github.com/lamemustafa/pack/commit/e3eaf4061351e8e8dbff3d94c24d014100050d76))
* **restart:** assert restart refusal messages ([#278](https://github.com/lamemustafa/pack/issues/278)) ([4a07611](https://github.com/lamemustafa/pack/commit/4a076119b8ba457eb6719e7317e4f5654c9f87ea))
* **runtime:** budget measured heavy artifact checks ([#232](https://github.com/lamemustafa/pack/issues/232)) ([3b689eb](https://github.com/lamemustafa/pack/commit/3b689eb9027d0d08144d85986c4d596938e47373))
* **styles:** enforce design token literals ([#245](https://github.com/lamemustafa/pack/issues/245)) ([f1459f3](https://github.com/lamemustafa/pack/commit/f1459f31ee379e4258303e997b10bb0094418518))
* **verifier:** assert an exact Playwright pin, not a version ([#326](https://github.com/lamemustafa/pack/issues/326)) ([f8af3cb](https://github.com/lamemustafa/pack/commit/f8af3cbae8c70f3285f4aaa58115a18cfdeaf4f8))
* **verify:** pin alpha panel reachability ([#275](https://github.com/lamemustafa/pack/issues/275)) ([4de6bdb](https://github.com/lamemustafa/pack/commit/4de6bdb3137255907c451f6c7aa5881d3ee08d83))


### Maintenance

* **deps-dev:** apply the dev-tooling group updates ([#332](https://github.com/lamemustafa/pack/issues/332)) ([7357532](https://github.com/lamemustafa/pack/commit/73575325b6046ac2ac267d937ad3cfbc6567c50a))
* **deps-dev:** bump @types/chrome from 0.2.6 to 0.2.7 ([#223](https://github.com/lamemustafa/pack/issues/223)) ([214aabd](https://github.com/lamemustafa/pack/commit/214aabdf77dd3884a44db62878bab4345a2da970))
* **deps-dev:** bump vitest from 4.1.10 to 4.1.11 ([#224](https://github.com/lamemustafa/pack/issues/224)) ([0cc40d9](https://github.com/lamemustafa/pack/commit/0cc40d923ea2953c701306e81233dc945a299285))
* **deps-dev:** take four dev-dependency bumps as one unit ([#273](https://github.com/lamemustafa/pack/issues/273)) ([4c367ff](https://github.com/lamemustafa/pack/commit/4c367ffe2f9656f3385987c26d429af87dab8d2f))
* **deps-dev:** upgrade vitest to 5.0.0 ([#330](https://github.com/lamemustafa/pack/issues/330)) ([c9e30e2](https://github.com/lamemustafa/pack/commit/c9e30e2df0a89eb8f1683035091e368fb9453891))
* **deps:** bump pnpm/action-setup to 6.1.0 in the github-actions group ([#335](https://github.com/lamemustafa/pack/issues/335)) ([930439a](https://github.com/lamemustafa/pack/commit/930439a0141118af5587833aa1086d76a7f81ec2))
* **deps:** consolidate validated dev dependency updates ([#165](https://github.com/lamemustafa/pack/issues/165)) ([2abfb66](https://github.com/lamemustafa/pack/commit/2abfb66e8dbde39702b1b223a6241b7a31bf6fe0))
* **deps:** group dependabot updates by risk tier ([#327](https://github.com/lamemustafa/pack/issues/327)) ([f706e00](https://github.com/lamemustafa/pack/commit/f706e006cd679a930e0c1268df715b7a29fc2b4d))
* **deps:** ignore @types/node majors and guard the alignment ([#331](https://github.com/lamemustafa/pack/issues/331)) ([937aae9](https://github.com/lamemustafa/pack/commit/937aae948acf0862d1c22fd4288e92a9ca1e58cc))
* **deps:** override @xmldom/xmldom to a patched release ([#284](https://github.com/lamemustafa/pack/issues/284)) ([ffbb42c](https://github.com/lamemustafa/pack/commit/ffbb42caab485b1549e7abc43ae35606cd14b27f))
* **node:** move the toolchain floor to Node 24 LTS ([#274](https://github.com/lamemustafa/pack/issues/274)) ([c2f9bd3](https://github.com/lamemustafa/pack/commit/c2f9bd39b70341e4ef08ea9a7ac48a0bc3f88755))

## [0.5.1](https://github.com/lamemustafa/pack/compare/v0.5.0...v0.5.1) (2026-08-17)


### Fixes

* **ci:** skip credentialless non-strict scheduled Store status checks with a notice and fail strict dispatches ([#144](https://github.com/lamemustafa/pack/issues/144)) ([1507f53](https://github.com/lamemustafa/pack/commit/1507f5361bd60a6c55de982c5e934f3fbece8b9a))


### Documentation

* **readiness:** record the v0.5.0 release state and gate the recovery matrix ([#144](https://github.com/lamemustafa/pack/issues/144)) ([1507f53](https://github.com/lamemustafa/pack/commit/1507f5361bd60a6c55de982c5e934f3fbece8b9a))


### Maintenance

* **ci:** consume the Store status tool's service-account or OAuth credential contract ([#144](https://github.com/lamemustafa/pack/issues/144)) ([1507f53](https://github.com/lamemustafa/pack/commit/1507f5361bd60a6c55de982c5e934f3fbece8b9a))
* **store-assets:** bind checked-in exports to their source SVG digests for verification ([#144](https://github.com/lamemustafa/pack/issues/144)) ([1507f53](https://github.com/lamemustafa/pack/commit/1507f5361bd60a6c55de982c5e934f3fbece8b9a))

## [0.5.0](https://github.com/lamemustafa/pack/compare/v0.4.0...v0.5.0) (2026-08-17)


### Features

* **evidence:** represent GSTR JSON artifacts in filed-return live evidence ([#110](https://github.com/lamemustafa/pack/issues/110)) ([54479aa](https://github.com/lamemustafa/pack/commit/54479aab165bc3d0073da3d1b0fb8e6264396ccc))


### Fixes

* **download:** bind portal blob capture and cancellation to the Pack action ([#112](https://github.com/lamemustafa/pack/issues/112)) ([22ae918](https://github.com/lamemustafa/pack/commit/22ae9181458605b5735ca3807c22aa4e67be4a3f))
* **gst:** bind filed-return acquisition to the requested target ([#96](https://github.com/lamemustafa/pack/issues/96)) ([bf10bf3](https://github.com/lamemustafa/pack/commit/bf10bf3df589aec7b76ffc9d7b5891ea37cab996))
* **gst:** harden full-year artifact staging ([#142](https://github.com/lamemustafa/pack/issues/142)) ([76916d8](https://github.com/lamemustafa/pack/commit/76916d81fea1d03f737179a01c373e52669cf7df))
* **gst:** restore the private source-build GSTR-2B dashboard and download ([#125](https://github.com/lamemustafa/pack/issues/125)) ([32a92e7](https://github.com/lamemustafa/pack/commit/32a92e76f27fe32c6034e12de26b299994f19e6a))
* **injection:** make MAIN-world functions self-contained across the executeScript boundary ([#116](https://github.com/lamemustafa/pack/issues/116)) ([20e7422](https://github.com/lamemustafa/pack/commit/20e74220374f27302e82e256be57c11b25ffde42))
* **recovery:** keep unproven artifact outcomes in review ([#106](https://github.com/lamemustafa/pack/issues/106)) ([c3c98ea](https://github.com/lamemustafa/pack/commit/c3c98ea50b9c1d78eb863950ce5492d258a30641))
* **recovery:** persist direct download completion proof ([#135](https://github.com/lamemustafa/pack/issues/135)) ([52c66d8](https://github.com/lamemustafa/pack/commit/52c66d86fe4575a5ce90e29802a0d9948e8cf323))
* **recovery:** reconcile a cancelled target from exact download evidence ([#113](https://github.com/lamemustafa/pack/issues/113)) ([b7447bb](https://github.com/lamemustafa/pack/commit/b7447bb72c8acf88e87e73df7eab9004aca0acd2))
* **recovery:** reconcile a completed acquisition checkpoint after worker death ([#117](https://github.com/lamemustafa/pack/issues/117)) ([61b63fd](https://github.com/lamemustafa/pack/commit/61b63fda265c61a9150a4ad7c99e95de7ab76c52))
* **recovery:** retain acquisition checkpoints ([#126](https://github.com/lamemustafa/pack/issues/126)) ([93171b4](https://github.com/lamemustafa/pack/commit/93171b41a97460d663b5f9b29410af5c466eadcd))


### Documentation

* **agent:** align reviewed manifest boundaries ([#82](https://github.com/lamemustafa/pack/issues/82)) ([818ebf7](https://github.com/lamemustafa/pack/commit/818ebf7f4ca6b13ebf92dad9d166fe6fb63be804))
* **agents:** record that the PR body is gated and where its contract lives ([#114](https://github.com/lamemustafa/pack/issues/114)) ([ff95027](https://github.com/lamemustafa/pack/commit/ff95027d303b49d0fdc093ca1514b28c319ed8f1))
* **privacy:** disclose full-year ZIP correlation fields and retained JSON bytes ([#105](https://github.com/lamemustafa/pack/issues/105)) ([4fbdd78](https://github.com/lamemustafa/pack/commit/4fbdd78f8d08e2a1b2c4f6837b7aff69c1413bf3))
* **readiness:** add full-year recovery QA matrix ([#132](https://github.com/lamemustafa/pack/issues/132)) ([9cd0737](https://github.com/lamemustafa/pack/commit/9cd0737d7e46035be639692c00c7b43d821a3813))
* **readiness:** clarify full-year recovery matrix ([#134](https://github.com/lamemustafa/pack/issues/134)) ([114b80a](https://github.com/lamemustafa/pack/commit/114b80a4b50e4ac524857868f6348212a7c41d08))
* **store:** refresh v0.4.0 listing assets ([#83](https://github.com/lamemustafa/pack/issues/83)) ([c7d306e](https://github.com/lamemustafa/pack/commit/c7d306ed1acb0920a1d00c785755238c8b78a668))


### Tests

* **release:** cover release-please API contract ([#133](https://github.com/lamemustafa/pack/issues/133)) ([155fd54](https://github.com/lamemustafa/pack/commit/155fd547f84b03671da754dc14c7cbe2a35d22dd))


### Maintenance

* **deps-dev:** bump @types/chrome from 0.2.2 to 0.2.5 ([#129](https://github.com/lamemustafa/pack/issues/129)) ([371f87a](https://github.com/lamemustafa/pack/commit/371f87a791909eab8852471523e0df9b0aaaf922))
* **deps-dev:** bump prettier from 3.9.4 to 3.9.6 ([#89](https://github.com/lamemustafa/pack/issues/89)) ([28204b3](https://github.com/lamemustafa/pack/commit/28204b3ed04e0a30754e01517224e97bf9497715))
* **deps-dev:** bump release-please from 17.10.1 to 17.11.1 ([#128](https://github.com/lamemustafa/pack/issues/128)) ([d2fd677](https://github.com/lamemustafa/pack/commit/d2fd67757e0e20e2c02a3a3024a2f848b31fdd9a))
* **deps-dev:** bump typescript-eslint from 8.63.0 to 8.65.0 ([#88](https://github.com/lamemustafa/pack/issues/88)) ([a92babd](https://github.com/lamemustafa/pack/commit/a92babdaac68af24933e597e971db6975ffce3f2))
* **deps:** bump actions/checkout from 7.0.0 to 7.0.1 ([#86](https://github.com/lamemustafa/pack/issues/86)) ([4d4bb4e](https://github.com/lamemustafa/pack/commit/4d4bb4e44ea4061b4c0b4b448cec6ab3ab83d3dd))
* **deps:** bump actions/setup-node from 6.4.0 to 7.0.0 ([#87](https://github.com/lamemustafa/pack/issues/87)) ([3b8492e](https://github.com/lamemustafa/pack/commit/3b8492ed10dba841307915056593aec7843b0da9))
* **deps:** consolidate validated updates ([#143](https://github.com/lamemustafa/pack/issues/143)) ([371d8a0](https://github.com/lamemustafa/pack/commit/371d8a028285ac43f8b98dab5abad3ed6b2f6739))
* **deps:** remediate high severity audit findings ([#94](https://github.com/lamemustafa/pack/issues/94)) ([ae38ce8](https://github.com/lamemustafa/pack/commit/ae38ce8f67a52ad390b923c94323f2eab24694ed))

## [0.4.0](https://github.com/lamemustafa/pack/compare/v0.3.3...v0.4.0) (2026-07-16)


### Features

* **gstr2b:** add private GSTR-2B downloads ([#66](https://github.com/lamemustafa/pack/issues/66)) ([00636f4](https://github.com/lamemustafa/pack/commit/00636f43a186177e4d290ff34b598f8d0f4cfc3c))


### Fixes

* **gst:** stabilize filed-return downloads and recovery ([#78](https://github.com/lamemustafa/pack/issues/78)) ([1d706da](https://github.com/lamemustafa/pack/commit/1d706da37f130652fb7aabb14310e2a404360d11))


### Documentation

* **cws:** record v0.3.2 publication ([94318f5](https://github.com/lamemustafa/pack/commit/94318f516645819abe8627555fa6e8ab2cd89842))


### Maintenance

* **deps:** align Pack dev dependency updates ([a3ac659](https://github.com/lamemustafa/pack/commit/a3ac659fc79cee04b85ea8f8f83e80c1422a578e))
* **deps:** update validated test tooling ([#80](https://github.com/lamemustafa/pack/issues/80)) ([494bfa4](https://github.com/lamemustafa/pack/commit/494bfa459e2954ab55f19fc72bc2a1b33ef32ab7))

## [0.3.3](https://github.com/lamemustafa/pack/compare/v0.3.2...v0.3.3) (2026-07-05)


### Documentation

* **cws:** add dashboard closeout runbook ([412515f](https://github.com/lamemustafa/pack/commit/412515f6bccec426d77d9fdd48b93892adaf3b41))
* **cws:** add dashboard closeout runbook ([412515f](https://github.com/lamemustafa/pack/commit/412515f6bccec426d77d9fdd48b93892adaf3b41))
* **cws:** expand Pack store asset set ([ed6d209](https://github.com/lamemustafa/pack/commit/ed6d209225c4e5a4d522cf8dae0cca73a6796199))
* **release:** record v0.3.2 publication evidence ([#53](https://github.com/lamemustafa/pack/issues/53)) ([b85d10d](https://github.com/lamemustafa/pack/commit/b85d10db7f3be03ad5c7093a90f62987a9dc611e))
* **store:** add verified CWS asset exports ([#55](https://github.com/lamemustafa/pack/issues/55)) ([1379961](https://github.com/lamemustafa/pack/commit/13799611e30cbb4e73f2634902cc3f729b910093))
* **store:** record v0.3.2 CWS submission ([ff0b2c8](https://github.com/lamemustafa/pack/commit/ff0b2c8629c2a80462d98c483c37a668b0f124f5))

## [0.3.2](https://github.com/lamemustafa/pack/compare/v0.3.1...v0.3.2) (2026-07-04)


### Fixes

* **gst:** harden Pack closed-review follow-ups ([#48](https://github.com/lamemustafa/pack/issues/48)) ([5502678](https://github.com/lamemustafa/pack/commit/5502678681df76f24caa08c99984dc6e191c7533))


### Documentation

* document Sanchika coordination ([595deb0](https://github.com/lamemustafa/pack/commit/595deb04b66981088d1013223497ca63e3d1adec))
* **release:** clear stale unreleased changelog ([#52](https://github.com/lamemustafa/pack/issues/52)) ([3767be5](https://github.com/lamemustafa/pack/commit/3767be5a6928f1b10f875e0ed4e57fe78395c233))
* **store:** update v0.3.1 listing assets ([#49](https://github.com/lamemustafa/pack/issues/49)) ([ea5b47c](https://github.com/lamemustafa/pack/commit/ea5b47cafaf25a46a559f0246e6e6a727fca640b))

## [0.3.1](https://github.com/lamemustafa/pack/compare/v0.3.0...v0.3.1) (2026-07-03)


### Fixes

* align Pack store listing metadata ([#46](https://github.com/lamemustafa/pack/issues/46)) ([5107ab2](https://github.com/lamemustafa/pack/commit/5107ab28731dcfb26a04f2bfc9a52223d04e9907))


### Documentation

* native Claude Code config (CLAUDE.md, subagents, skills) ([#44](https://github.com/lamemustafa/pack/issues/44)) ([0161b8f](https://github.com/lamemustafa/pack/commit/0161b8fcfea919470f396329c5eff8e7daf7ff63))

## [0.3.0](https://github.com/lamemustafa/pack/compare/v0.2.2...v0.3.0) (2026-07-03)


### Features

* **gst:** support GSTR-1 filed-return downloads ([94a1ec9](https://github.com/lamemustafa/pack/commit/94a1ec9a65ef4dc47bf3e5f0737fc7d908c4cdba))

## [0.2.2](https://github.com/lamemustafa/pack/compare/v0.2.1...v0.2.2) (2026-07-02)


### Fixes

* **release:** harden Chrome Web Store submission ([#39](https://github.com/lamemustafa/pack/issues/39)) ([85ee506](https://github.com/lamemustafa/pack/commit/85ee506b5b939738ec3bafe0348d78b3165ef57e))
* **release:** require bound CWS provenance ([#41](https://github.com/lamemustafa/pack/issues/41)) ([ec8f0f1](https://github.com/lamemustafa/pack/commit/ec8f0f1d809edacde6152f598125587c01753fda))

## [0.2.1](https://github.com/lamemustafa/pack/compare/v0.2.0...v0.2.1) (2026-07-01)


### Maintenance

* **deps-dev:** bump eslint-plugin-react-hooks to 7.1.1 ([ad7c797](https://github.com/lamemustafa/pack/commit/ad7c79709fdbc20d79e1e102ba9749e926972a1b))
* **deps-dev:** bump globals to 17.7.0 ([9a6e179](https://github.com/lamemustafa/pack/commit/9a6e1795050a101ba2d968853220e70b88ba8bff))
* **deps-dev:** bump typescript from 5.9.3 to 6.0.3 ([13585df](https://github.com/lamemustafa/pack/commit/13585dfc3c0363887a41203c91fceecfcd5c59bc))
* **deps-dev:** bump wxt from 0.20.26 to 0.20.27 ([e8e02c5](https://github.com/lamemustafa/pack/commit/e8e02c591546bfa9494637b59413522a169265a8))

## [0.2.0](https://github.com/lamemustafa/pack/compare/v0.1.0...v0.2.0) (2026-07-01)


### Features

* add source-build alpha full fiscal year filed-return ledger ([16c9789](https://github.com/lamemustafa/pack/commit/16c97894fb293bfaf8a97d5db08070ea23c0de1c))
* **release:** automate Pack GitHub and Chrome Web Store releases ([#32](https://github.com/lamemustafa/pack/issues/32)) ([d551d14](https://github.com/lamemustafa/pack/commit/d551d141ec0f3174055e1ecc32d94f40ea00bbd1))


### Fixes

* bind filed-return downloads to verified targets ([70bf502](https://github.com/lamemustafa/pack/commit/70bf5028dfd57840f3c9d8a1c7c341c32ef16d0d))
* disable unsafe full-year filed return downloads ([0cd163c](https://github.com/lamemustafa/pack/commit/0cd163cf059c843d0ba13bc7814c9508599871d3))
* **download:** suggest filed-return download paths ([#26](https://github.com/lamemustafa/pack/issues/26)) ([94f0456](https://github.com/lamemustafa/pack/commit/94f045629a314773557d51b909217af128af0d41))
* **gst:** automate filed-return downloads without Save dialog ([#33](https://github.com/lamemustafa/pack/issues/33)) ([060324a](https://github.com/lamemustafa/pack/commit/060324a327d53191fbb42b7071598ddbf7aa5fdc))
* **gst:** harden filed returns portal flow ([#23](https://github.com/lamemustafa/pack/issues/23)) ([ab9d57b](https://github.com/lamemustafa/pack/commit/ab9d57bc6b5d9909cc91c9e2352786251ce0eca4))
* **gst:** harden filed-return downloads ([#24](https://github.com/lamemustafa/pack/issues/24)) ([47e42fd](https://github.com/lamemustafa/pack/commit/47e42fd9cb8511906f6a2ddebedb95e415c735f6))
* **gst:** harden Pack review follow-ups ([#25](https://github.com/lamemustafa/pack/issues/25)) ([78f9d3e](https://github.com/lamemustafa/pack/commit/78f9d3e8001024632b2435404eca21357ac6e1c4))
* harden filed-return download flow ([a6f8f2e](https://github.com/lamemustafa/pack/commit/a6f8f2ed13f6d089b3022cc71a0e913b85bf96c3))
* **recovery:** harden full-year retry and review gates ([0488399](https://github.com/lamemustafa/pack/commit/0488399b621b0f1232b9c97f9e8a503a5b8255c8))
* **release:** avoid disallowed release action ([bc7727f](https://github.com/lamemustafa/pack/commit/bc7727fc006997752fbcb0d334e484c2223f572a))
* **release:** close Pack release correctness gaps ([1becb1f](https://github.com/lamemustafa/pack/commit/1becb1f1774353e7c468237fe59069763c0295b6))
* **release:** harden Chrome Web Store publishing ([755c489](https://github.com/lamemustafa/pack/commit/755c489b7e07e23eac766f9d6df1edddd9eb7bdf))
* **release:** make release PRs pass Pack gates ([b85d17e](https://github.com/lamemustafa/pack/commit/b85d17e949cabab3732680723d7273d6f58efb46))
* **verify:** harden Pack harness policy gates ([#20](https://github.com/lamemustafa/pack/issues/20)) ([b2e0934](https://github.com/lamemustafa/pack/commit/b2e09349c97946a260247df3a024ad330f4f8f2f))


### Documentation

* harden Pack public-claim workflow ([#19](https://github.com/lamemustafa/pack/issues/19)) ([95d299a](https://github.com/lamemustafa/pack/commit/95d299af96037578060120870ff87f8b1611e7a3))
* tighten Pack agent guardrails ([#17](https://github.com/lamemustafa/pack/issues/17)) ([e657f39](https://github.com/lamemustafa/pack/commit/e657f395476cffbb3a4b33c8f646be23fee63aec))


### Tests

* **release:** load Pack ZIP in pinned Chromium ([#22](https://github.com/lamemustafa/pack/issues/22)) ([37a5fc3](https://github.com/lamemustafa/pack/commit/37a5fc3d2617958ec61d373efbf5d65b07d50114))


### Maintenance

* add Pack workflow preflight ([#18](https://github.com/lamemustafa/pack/issues/18)) ([7f3dac7](https://github.com/lamemustafa/pack/commit/7f3dac767181eb2a3f340a55da4ff26d2d161150))

## 0.1.0 - 2026-06-23

- Initial Chrome MV3 V0 source alpha. No Chrome Web Store listing or approval is
  published yet.
- Local-first GSTR-3B PDF download workflow for supported GST Portal sessions.
- Synthetic reviewer demo that works without GST Portal credentials and writes
  demo manifest, index, and exception-report artifacts locally.
- Live GST PDF downloads do not yet write live manifest, index, or exception
  records.
- Extension storage is limited to install metadata, the active filed-returns run
  lease, the single-period target-review marker, the full fiscal year ledger,
  the last synthetic demo manifest summary, and temporary session workflow
  snapshots; the Options page clear-data control removes those Pack storage
  keys.
- The popup is now focused on live filed-return downloads; synthetic reviewer
  demo, last synthetic manifest, and broad local-data clearing controls live in
  Pack Options.
- CI pins third-party actions to commit SHAs, runs high-severity dependency
  audit, and prints the verified Chrome ZIP checksum as release evidence.
- Filed GSTR-3B final download clicks are now target-bound to the visible period
  and financial year, and the retryable navigation step no longer clicks the
  final portal download control.
- Full fiscal year download is available as a source-build alpha local
  per-period ledger. It remains outside Chrome Web Store readiness until durable
  restart/resume, positive not-filed evidence, live full-year QA, and privacy
  review gates are complete.
- Exact GST host permissions only.
- No ComplyEaze login, analytics, credential capture, cookie capture, or GST file
  upload in the local-download workflow.
