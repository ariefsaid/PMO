# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

## [0.46.0](https://github.com/ariefsaid/PMO/compare/v0.45.0...v0.46.0) (2026-11-27)


### Features

* price-hidden requesters raise item-and-quantity requests with evidence ([8877a53](https://github.com/ariefsaid/PMO/commit/8877a534589024f1e030d00925b7d7daf477790e))
* Project Manager and Deputy read money for their own projects only ([ecef953](https://github.com/ariefsaid/PMO/commit/ecef9530b829c3f35baa74b132edf3d1879ff2e5))
* screen round stage 1, ten areas recomposed in the order of work ([28c1dd5](https://github.com/ariefsaid/PMO/commit/28c1dd59e5ca689acc7c04a5abbbfb11b07014e6))
* screen round stage 2, rendered-review fixes and the remaining areas ([eaef03e](https://github.com/ariefsaid/PMO/commit/eaef03e3d1397bc6093515b497d833995358e2a6))


### Bug Fixes

* a Project Manager reads approval figures for another project only while a request waits on them; only a project's manager names its deputy; the project's billing follows the money scope ([826761b](https://github.com/ariefsaid/PMO/commit/826761b35af58f4a6b35eb40a178f2cec81b27c7))
* Accounting and Procurement screen spacing, in the shared tabs and card tables ([644e5b0](https://github.com/ariefsaid/PMO/commit/644e5b0fcb35041f599a2743f6cea0445c3fb571))
* align release journeys with current screen controls ([dce0303](https://github.com/ariefsaid/PMO/commit/dce03036960d95a7ca86691a4052ccb95c6cc815))
* audit round of defect fixes and quick speed wins ([6b16074](https://github.com/ariefsaid/PMO/commit/6b160747a16c03ef1363cc17be723fd2146ef560))
* buyer receipts and claim cost proofs; one copy of each shared rule ([b58aeff](https://github.com/ariefsaid/PMO/commit/b58aeff88a984dab46ae4c5ec20ff67e4f0606dd))
* coalesce table resize speed work ([bfdd85f](https://github.com/ariefsaid/PMO/commit/bfdd85fe179e2f84b862e58264afed214f8a6d51))
* **dashboard:** align waiting-work heading and action ([d67bd3d](https://github.com/ariefsaid/PMO/commit/d67bd3d25eec1a70c53e2a93a88317e65d268e63))
* **delivery-note:** retain readable phone lines and localized signatures ([8c3a68b](https://github.com/ariefsaid/PMO/commit/8c3a68b00819253743281eb959e8ae927a62d469))
* end an open equipment rental from its asset ([#2795](https://github.com/ariefsaid/PMO/issues/2795)) ([b226abe](https://github.com/ariefsaid/PMO/commit/b226abefe2a4c2c8b1157ad4b32965f76885a1c8))
* **erp-purchases:** expose active queue and fit phone summaries ([6d8b77b](https://github.com/ariefsaid/PMO/commit/6d8b77b034ba67fb628f64f4b639c375765dd45b))
* **executive-dashboard:** distinguish overdue work from late phases ([9dbb18e](https://github.com/ariefsaid/PMO/commit/9dbb18efd1df0b31760cdbb0b66b9df5d1a69604))
* explain and retry unavailable project filters ([cbb7569](https://github.com/ariefsaid/PMO/commit/cbb7569787663fa1ef22bb333e839ad6dbc131e7))
* follow recomposed report and revenue journeys ([2d0b3ca](https://github.com/ariefsaid/PMO/commit/2d0b3ca72d2b58738f770f5ca38bcb88e87bf9c3))
* **forecast:** separate recorded spending from project commitments ([1353af5](https://github.com/ariefsaid/PMO/commit/1353af560ec4f441da2294d81a86e0e8bab9636a))
* improve shared table and navigation speed ([5e605b7](https://github.com/ariefsaid/PMO/commit/5e605b7c372a2f50e03781e76fa12503d5780497))
* improve tab and phone board speed ([fa94da0](https://github.com/ariefsaid/PMO/commit/fa94da0d0138da154fc81bf5c3514841d4485560))
* JOB-PU6 clicks the page's Record payment action ([cd387ff](https://github.com/ariefsaid/PMO/commit/cd387ff8e3bf80063d0d43b405d1f47eb8c1fcac))
* JOB-PU6 clicks the page's Record payment action, not the ledger's same-named capture button ([2bbb593](https://github.com/ariefsaid/PMO/commit/2bbb593201313911ea802903527915e745f20fc3))
* **journals:** align date filters and fit full figures inside the drawer ([5d41fc4](https://github.com/ariefsaid/PMO/commit/5d41fc49a62ee986373b4700b292f2566096c54c))
* journeys follow the recomposed screens; daily target gap wording restored ([88bcaa6](https://github.com/ariefsaid/PMO/commit/88bcaa6ad1cc9f698036e85b0607c7b822160af8))
* keep a stock document file when its delete is refused ([8b302dc](https://github.com/ariefsaid/PMO/commit/8b302dc6320fdcdad9c7193171083e9436a94f32))
* keep failed finance reads consistent ([#2438](https://github.com/ariefsaid/PMO/issues/2438)) ([4600a32](https://github.com/ariefsaid/PMO/commit/4600a321a67b0a13e8a29b18cf1424b7b4b14948))
* keep rail keyboard navigation at speed ([9e8bdc7](https://github.com/ariefsaid/PMO/commit/9e8bdc781c3fc4dfd341ae99d01b163962abc921))
* keep unavailable purchase order figures explicit and retry settings reads ([8d8020f](https://github.com/ariefsaid/PMO/commit/8d8020ff342309b22ca02cad01f251bbd04508b6))
* land nine finished fixes that never reached dev ([17fc907](https://github.com/ariefsaid/PMO/commit/17fc90719a60ee4a5bf5bdc7e53e357825cc30d6))
* load a page's own sections and data modules with the page ([54e4cd6](https://github.com/ariefsaid/PMO/commit/54e4cd64809b03e0f79ec6b0e2527b18b2f529c6))
* load stock reports and home work orders efficiently ([#2818](https://github.com/ariefsaid/PMO/issues/2818)) ([ceafe5e](https://github.com/ariefsaid/PMO/commit/ceafe5ee0a4930e44a8609f04db76b8c6ce64029))
* make journey fixture guard independent of checkout metadata ([5c1fd76](https://github.com/ariefsaid/PMO/commit/5c1fd76b87303037703c10eadf9d8dd7da09ea8a))
* org-day guard on Linux and the clock-in journey's day ([5263b71](https://github.com/ariefsaid/PMO/commit/5263b71b23db9b5ddc52a7fc1d1ae0bd286ca8b1))
* password reset form after the emailed link; four serial journeys brought up to date ([17fbc66](https://github.com/ariefsaid/PMO/commit/17fbc66e6fe8e11171c1b56c4c919036a6b26e8c))
* preserve administration drafts and surface unavailable reads ([941a18e](https://github.com/ariefsaid/PMO/commit/941a18e75122b191b34c19f708582cdbc2d2b285))
* preserve drafts and show recoverable screen states ([6b49a8f](https://github.com/ariefsaid/PMO/commit/6b49a8fe7f273a3d3552c4fac1c78f8abc365017))
* preserve integrated screen contracts and journey fixtures ([c9ddd49](https://github.com/ariefsaid/PMO/commit/c9ddd49b2cb37212cbd19fc306715259ac78ca83))
* preserve lazy repository contracts (initial JS 1.788 to 1.793 MB) ([86fa6f0](https://github.com/ariefsaid/PMO/commit/86fa6f027866c65640483092250758ad0a0c7c88))
* preserve localized hours and phone note spacing ([#2440](https://github.com/ariefsaid/PMO/issues/2440)) ([1bdfef8](https://github.com/ariefsaid/PMO/commit/1bdfef8bb1e603590a46745b668ac8cfb2b2cd3f))
* preserve purchase attribution and planning edits when leaving drafts ([27a1e24](https://github.com/ariefsaid/PMO/commit/27a1e2460337fc11921aa3bff6bb6eef97aae7a3))
* preserve shared layer behaviour at speed ([ad67fce](https://github.com/ariefsaid/PMO/commit/ad67fce1b440b2b983c0d1874e2cab1f8b256935))
* **print:** stack line details on phones and simplify the toolbar ([f1d4356](https://github.com/ariefsaid/PMO/commit/f1d4356f4638696e6eb97ecf0446464e3796f540))
* **project-budget:** bring category comparisons above the fold ([75a5989](https://github.com/ariefsaid/PMO/commit/75a598908c16c374207bda06915d4891f4461651))
* **project:** finish evidence batches before closing and retry remaining items ([a98da43](https://github.com/ariefsaid/PMO/commit/a98da436270da3f7b2dfab6b09c1fc00e5ec6263))
* **project:** offer phase deletion in the mobile planner ([fb8e2f4](https://github.com/ariefsaid/PMO/commit/fb8e2f401afc61f00aaf0aee60fa2a9d65cdc3a7))
* **project:** preserve unsaved area rate drafts on refresh ([7f3a9a9](https://github.com/ariefsaid/PMO/commit/7f3a9a9492ef68b5b085a2e7c1b6cac08217acbf))
* **project:** protect billing terms while loading and replacing stages ([fce9067](https://github.com/ariefsaid/PMO/commit/fce9067b06b3b7f6c02cd95bb014692e18b00807))
* **project:** report and refresh partial document saves before retry ([23f64e8](https://github.com/ariefsaid/PMO/commit/23f64e84155ded1b9a383b9170a5876945288a6d))
* **project:** reset quantity when changing material item ([948dfd9](https://github.com/ariefsaid/PMO/commit/948dfd987dc7727827bedd1c44ed225a70e7cb9d))
* **project:** retain document draft changes when categories load ([ab7054c](https://github.com/ariefsaid/PMO/commit/ab7054c23ddf3b881ab18da970f753b624b8bfc8))
* **project:** retry failed discipline names with profit reads ([06841f5](https://github.com/ariefsaid/PMO/commit/06841f5556b84ef660b36dfc5216182ffe92410b))
* **project:** show retry for failed work order billing steps ([10a5f7e](https://github.com/ariefsaid/PMO/commit/10a5f7e1caa1b5cab370ae6419e0a7c14b9d4cca))
* **projects:** start statement reads alongside money projections ([710aabd](https://github.com/ariefsaid/PMO/commit/710aabd44e05fa540a7fe7b3ae0e959ed9be6f03))
* **project:** wait for default billing template before changing it ([31f4404](https://github.com/ariefsaid/PMO/commit/31f4404f81737add4caed1821a18005a3ec02978))
* **purchase-order-print:** preserve mobile item figures and align collector ([bba04f8](https://github.com/ariefsaid/PMO/commit/bba04f877b04efe6b0721aa8b909ca2178ab4bcc))
* **receipts:** lead with payments and retain invoice identity on phones ([f0176be](https://github.com/ariefsaid/PMO/commit/f0176be60bb383d0cbdc5af08176dd856ab14f91))
* reconcile integrated screen behavior and validation ([635821f](https://github.com/ariefsaid/PMO/commit/635821f5e6ce78c1c21b3422fdc14e25e1268710))
* **reports:** distinguish missing contracts and compact period controls ([fa6c6d0](https://github.com/ariefsaid/PMO/commit/fa6c6d03bc18a4e4a40074ef5fa7bd5cd120cfc6))
* **reports:** keep the first tablet row visible and update date entry steps ([a58fe10](https://github.com/ariefsaid/PMO/commit/a58fe10df7919c14d8ad5a39556fa95c7a2ac5cb))
* retain ledger currency in category spending details ([5914796](https://github.com/ariefsaid/PMO/commit/5914796d00ba8309f8545b4e1e5d15ada5e9f375))
* retain work order edit modal contract during integration ([2aeebb1](https://github.com/ariefsaid/PMO/commit/2aeebb1708efd421636e9c0ea5df87ff9c4c2301))
* retry failed safety module settings ([ab3ba73](https://github.com/ariefsaid/PMO/commit/ab3ba73dcd7d662cb70f7b202cfdfe5c0b35e76c))
* retry the invoice record requested by a direct link ([1293144](https://github.com/ariefsaid/PMO/commit/12931446a62bbaa2d0b6b5fe041825cfaef7334a))
* **safety:** localize month input and safety briefing labels ([2f7df98](https://github.com/ariefsaid/PMO/commit/2f7df984f3184d6b9e0805629b803a51499680b0))
* share missing-page and access states ([#2443](https://github.com/ariefsaid/PMO/issues/2443)) ([b532f1b](https://github.com/ariefsaid/PMO/commit/b532f1b0e8d5715638e6cefea8023f1c870adca3))
* show complete lists and accurate alert counts ([#2811](https://github.com/ariefsaid/PMO/issues/2811)) ([53477a7](https://github.com/ariefsaid/PMO/commit/53477a73877925f9d1c56e20cf4b4cab01f15fce))
* show work-order costs across all projects ([#2826](https://github.com/ariefsaid/PMO/issues/2826)) ([cb42eb1](https://github.com/ariefsaid/PMO/commit/cb42eb1bcaf634c1ffc08bfd468ca0d1c17df22a))
* **statements:** keep account figures readable on phones ([7ddb9ca](https://github.com/ariefsaid/PMO/commit/7ddb9ca8118b4034ab516c9318caa465f50a87c4))
* **statements:** provide a refresh action in the empty state ([4872562](https://github.com/ariefsaid/PMO/commit/48725629813f05a988a4c31a95052b9d3fb758ea))
* sums, notices, failure handling and journey fixtures (batch) ([eb5800c](https://github.com/ariefsaid/PMO/commit/eb5800cb70bfabe0a01497229dafe2e1101e38ca))
* **tables:** expose horizontal navigation outside the data track ([3306098](https://github.com/ariefsaid/PMO/commit/330609848f49646bf3aab78ef309f9d15666d946))
* tell readers whom to ask for folder access ([#2831](https://github.com/ariefsaid/PMO/issues/2831)) ([22326df](https://github.com/ariefsaid/PMO/commit/22326dfa1a8898a3bd361b9e83e615530c8f326b))
* **tests:** align Administration and command-palette harnesses with the shipped shell ([8f6a1a3](https://github.com/ariefsaid/PMO/commit/8f6a1a3b62945db567fca2eb9224ae67e21cff5f))
* the people fields rule holds a person's own write; the billing tests' manager manages the projects; the Orders journey reads the export ([4ddd65f](https://github.com/ariefsaid/PMO/commit/4ddd65fc2cbd8f3bc5bb01bad8d08a1a16c1b46f))
* the waiting list and each approval gate share one may-decide rule ([bf4a0c2](https://github.com/ariefsaid/PMO/commit/bf4a0c2b5b7b9c51a00e25bf11aaaf3aa10e1428))
* three journeys red on the release run (money-scope panel, Sales to Projects navigation, late rental checks read) ([8851775](https://github.com/ariefsaid/PMO/commit/88517759502f0e05fb1735b012cbbe229376bdbe))
* **transfer-print:** retain the year on the printed issue date ([52eac0d](https://github.com/ariefsaid/PMO/commit/52eac0dfac1fc9dca94b1b7c92233a5080ce92eb))
* **ui:** align meeting form sections on a single field edge ([bee7531](https://github.com/ariefsaid/PMO/commit/bee753182fa0618bad7b20fbc8954ec0d0c28fa2))
* **ui:** align mobile material quantities and clarify row actions ([f57d243](https://github.com/ariefsaid/PMO/commit/f57d24326d5ecd9f9a6cb7bc2bd691153dd3f562))
* **ui:** align shared empty states and localize displayed labels ([f3ed7fe](https://github.com/ariefsaid/PMO/commit/f3ed7feefc32d5419f6eaa834bb864a879dee402))
* **ui:** align shared record surfaces and compact phone toolbars ([195b0e1](https://github.com/ariefsaid/PMO/commit/195b0e1ee6427f0c90df024585bebe7e7d45b428))
* **ui:** align summary figures and use day-first snapshot dates ([7605f8f](https://github.com/ariefsaid/PMO/commit/7605f8ff53d89b150488d23ddc68e564924cfd64))
* **ui:** align task comments and expand search ([299bbfb](https://github.com/ariefsaid/PMO/commit/299bbfbeb6d12379585af0f2a0294f72e6c46ae9))
* **ui:** allow keyboard scrolling through approval hours ([82096a4](https://github.com/ariefsaid/PMO/commit/82096a465a23d2b86f2c079804c28367c893e56a))
* **ui:** clarify attendance fields and omit unused overtime ([80db19a](https://github.com/ariefsaid/PMO/commit/80db19a53ca2d0b36e1c0623d95ce988ceed7928))
* **ui:** clarify budget risk and align weekly submission labels ([33dc2d8](https://github.com/ariefsaid/PMO/commit/33dc2d8cbaddc90b571f37ad748b13cee6ffe0f8))
* **ui:** clarify decision routes and keep timesheet actions in their column ([cfbcb1d](https://github.com/ariefsaid/PMO/commit/cfbcb1d8a91260c6bc749a64f8807fabc269a55c))
* **ui:** clarify equipment and finance record information ([77a09ab](https://github.com/ariefsaid/PMO/commit/77a09abdf69ef9dd8c1b5421858228f822dd610c))
* **ui:** clarify receipt comparisons and sample invoice numbering ([3dc921f](https://github.com/ariefsaid/PMO/commit/3dc921f09e749c64d788e4bcdd994e9e34818187))
* **ui:** collapse phone task filters and label small chart segments ([07fa252](https://github.com/ariefsaid/PMO/commit/07fa252c3762b324f0eda8e858a57af2a494a82f))
* **ui:** compact contact rows and align directory controls ([f44b238](https://github.com/ariefsaid/PMO/commit/f44b2381c998d01f33c3cdc69136ae85c165374d))
* **ui:** compact invoice context and translate time-record terminology ([f05a12f](https://github.com/ariefsaid/PMO/commit/f05a12f92e19715c03e60ce749e8b35d43314251))
* **ui:** consolidate crew imports and compact placement dates ([15cf41a](https://github.com/ariefsaid/PMO/commit/15cf41a9eec83d23dee7e0bd54fc419f82ddedb8))
* **ui:** constrain company directory and compact phone rows ([e2fd18d](https://github.com/ariefsaid/PMO/commit/e2fd18d7aa0886558fcdbde3b91f05683375f796))
* **ui:** constrain document actions to the viewport ([2fbdbf6](https://github.com/ariefsaid/PMO/commit/2fbdbf63587018e7528708c75cdfa6119b23cc22))
* **ui:** contain status filters and expose scheduled report navigation ([e72fe5b](https://github.com/ariefsaid/PMO/commit/e72fe5b880ea90f55f13894884cdc173ebc0f954))
* **ui:** display month fields in the application language ([325eae8](https://github.com/ariefsaid/PMO/commit/325eae8cd86fa987ddb4c8ef01982750b786ac05))
* **ui:** enforce readable minimums on individual table columns ([07f59c2](https://github.com/ariefsaid/PMO/commit/07f59c2791d85ed8efc0f06a401a768ee08c2a0a))
* **ui:** expose meeting attendees and frame the minutes field ([3024859](https://github.com/ariefsaid/PMO/commit/3024859219da66da2c4f8b1952513d7be777a339))
* **ui:** fill saved view previews and name panels in everyday language ([0488663](https://github.com/ariefsaid/PMO/commit/0488663d9d9bdf3f2db3ed86e528fffaf4f4a756))
* **ui:** fit contact company filter within tablet toolbar ([8fdb2d6](https://github.com/ariefsaid/PMO/commit/8fdb2d6cd22cf6fdfa28b0b2d5676dd4cb8478c5))
* **ui:** fit deal stages and keep pre-win navigation in sales ([2003d55](https://github.com/ariefsaid/PMO/commit/2003d55d399ff0eb7dc9fc26e4268d01f9e9a31b))
* **ui:** fit pipeline stages and phone scope controls ([2e816f6](https://github.com/ariefsaid/PMO/commit/2e816f696f8f56af7bce549fbf8fe49911b683f2))
* **ui:** fit review date inputs and approval week grid ([0afad51](https://github.com/ariefsaid/PMO/commit/0afad51d50ac29fde320c3a25184f2fcf070a46f))
* **ui:** format month options with the active locale ([e1e86fc](https://github.com/ariefsaid/PMO/commit/e1e86fc5f640f97aee1c24223653db1b79c92656))
* **ui:** frame meeting records and expose action item creation ([79a188e](https://github.com/ariefsaid/PMO/commit/79a188e3cf80eb5efb983dc9145e9eab94c1a4d7))
* **ui:** frame project materials sections consistently ([012fc12](https://github.com/ariefsaid/PMO/commit/012fc1224f7ba8d108a98dceb3b5c1edcf655cca))
* **ui:** give claim type its own form row ([43ca81d](https://github.com/ariefsaid/PMO/commit/43ca81df96f8db53e2312e815e6cc01b5ad5d9d1))
* **ui:** group rate import with the catalogue ([e5ea606](https://github.com/ariefsaid/PMO/commit/e5ea6066c6c6a9490cd8bf3018039343176a3ecf))
* **ui:** handle empty chart values without minimum stubs ([cb380d6](https://github.com/ariefsaid/PMO/commit/cb380d60b37f6d1ccfa98956d6f7d5d89ed6eba0))
* **ui:** keep chart remainder labels readable at narrow widths ([847c039](https://github.com/ariefsaid/PMO/commit/847c0391fd0b886f2b85e38c3b1c02772429b5db))
* **ui:** keep claim choices concise ([28be8bb](https://github.com/ariefsaid/PMO/commit/28be8bb4ec385fbca835f14910a825175a4f8fe4))
* **ui:** keep contact email readable and align activity rows ([59cfb2b](https://github.com/ariefsaid/PMO/commit/59cfb2b6c64834785013118e8ae119e579e27d4d))
* **ui:** keep contract actions and settlement captions readable ([08335c0](https://github.com/ariefsaid/PMO/commit/08335c067022a867ada5fa2a655d1b02f8e105bf))
* **ui:** keep daily targets visible and cost guidance truthful ([c5e8a27](https://github.com/ariefsaid/PMO/commit/c5e8a273a55277acaa3e1fc11c223b139e2b8d14))
* **ui:** keep delivery note remarks readable ([08ed14f](https://github.com/ariefsaid/PMO/commit/08ed14f7a7952e0df09ce0780efa9b43a58d5c13))
* **ui:** keep journal date labels with their fields ([1d1d220](https://github.com/ariefsaid/PMO/commit/1d1d220be3932ce43b5c15e5c2c51a3d640c4e73))
* **ui:** keep printed documents legible and free of app chrome ([14d7e97](https://github.com/ariefsaid/PMO/commit/14d7e977820af471f0c2428c5a6f7f1e3e86d2b7))
* **ui:** keep project context and actions in their header ([1fda41b](https://github.com/ariefsaid/PMO/commit/1fda41b97388f36142d9d71554b640873737e570))
* **ui:** keep purchase order amounts and details readable ([d09602a](https://github.com/ariefsaid/PMO/commit/d09602afe164c6248b57986604ef746b0743836c))
* **ui:** keep report captions and money headings readable ([bfcecba](https://github.com/ariefsaid/PMO/commit/bfcecba37cd4d5d8172841ab1858953f38054ba5))
* **ui:** keep task and approval identities readable at narrow widths ([a6c3961](https://github.com/ariefsaid/PMO/commit/a6c396101a61fbf14c97176149ead1c9078d79cb))
* **ui:** lead saved view composition with panels ([c2b8dff](https://github.com/ariefsaid/PMO/commit/c2b8dffad5e93cc2710700bc8f467001ff04d2c4))
* **ui:** localize project consumption month pickers ([452443d](https://github.com/ariefsaid/PMO/commit/452443d2e9b7268319c75a088af451c3dad30f58))
* **ui:** make saved views editable and let lone panels fill the canvas ([ae6afde](https://github.com/ariefsaid/PMO/commit/ae6afde14c5300da94ff5abcb9cc7e2b1e555c9f))
* **ui:** omit empty manpower progress bar ([e553b38](https://github.com/ariefsaid/PMO/commit/e553b386c85d9c33223acdb7aff7c3e03aba552d))
* **ui:** preserve customer name boundaries in project context ([92d7aab](https://github.com/ariefsaid/PMO/commit/92d7aab3901797d90a00d65027e687e96881a31c))
* **ui:** preserve details keyboard dismissal and browser journey proofs ([f94d46c](https://github.com/ariefsaid/PMO/commit/f94d46cc4159f5f30fb02ecace4b7ec19785e0c6))
* **ui:** preserve mobile content and screen journeys ([23388ac](https://github.com/ariefsaid/PMO/commit/23388ac7777c7d6db841813747cbca728d65cbc2))
* **ui:** preserve project width in approval week previews ([61e8574](https://github.com/ariefsaid/PMO/commit/61e85746c13b9f66d90c9979d24a67d4ffbfadd3))
* **ui:** preserve readable table widths within scroll panes ([5ce4537](https://github.com/ariefsaid/PMO/commit/5ce4537b8ea6ae8950045eeedfada9d153d71ead))
* **ui:** preserve record breadcrumbs at tablet width ([cc203ca](https://github.com/ariefsaid/PMO/commit/cc203caeed88267e1401fe7800bdf426d3ee2dbf))
* **ui:** preserve tablet workspace and unobstructed money columns ([cb2bc37](https://github.com/ariefsaid/PMO/commit/cb2bc37ef8972e3494c51943a2ca04016053e207))
* **ui:** preserve unavailable fields and integration contracts ([d2d37f9](https://github.com/ariefsaid/PMO/commit/d2d37f9f74c85d523c2405691c5333fe419b2118))
* **ui:** put company facts in the header and align record sections ([2925f26](https://github.com/ariefsaid/PMO/commit/2925f26db9c05e06d02740be03397038f686f726))
* **ui:** quiet project editing alongside tab actions ([65f0bcd](https://github.com/ariefsaid/PMO/commit/65f0bcd848a0a688f6d1892e0bb6083a3225a787))
* **ui:** recognize decimal text on non-valued approval reviews ([2acfe66](https://github.com/ariefsaid/PMO/commit/2acfe66ba490a012527d515a16f7d018c5c6ffb9))
* **ui:** reflow budget figures across viewport widths ([7b362e9](https://github.com/ariefsaid/PMO/commit/7b362e9cf431d6445277f9e5b7b9c211fa8c665a))
* **ui:** refresh month labels when locale changes ([0e06790](https://github.com/ariefsaid/PMO/commit/0e06790e0670e6ba8569933fabb08d33317d6a90))
* **ui:** refresh shared month formatting on each render ([b363396](https://github.com/ariefsaid/PMO/commit/b36339634cc6bafbf45c4cf9ffb4503f0ad917c1))
* **ui:** refresh table money cells when number locale changes ([25cf54d](https://github.com/ariefsaid/PMO/commit/25cf54d40f2366a0a778e2b1c10e9e4f08642997))
* **ui:** remove redundant leave settings save action ([0a8649b](https://github.com/ariefsaid/PMO/commit/0a8649b8f9d44a3686594ac278ba629b7288f82e))
* **ui:** reserve room for whole budget status labels ([0dfa80f](https://github.com/ariefsaid/PMO/commit/0dfa80f8f14c1e1f5618ecd50933564822806897))
* **ui:** resolve quantity request title and separate chart labels ([f6d2f09](https://github.com/ariefsaid/PMO/commit/f6d2f0912869aaf7c836d6385e6b4cc345b35dcd))
* **ui:** restore financial facts and align screen journeys ([c86d6a7](https://github.com/ariefsaid/PMO/commit/c86d6a7fb384f6c2995cda1e8b0b2999666cea27))
* **ui:** retain kickoff detail beside portfolio project facts ([ff3943d](https://github.com/ariefsaid/PMO/commit/ff3943d63b77a22e1a366e540cdd93f38830e235))
* **ui:** retain shared menu stacking level ([9726ee1](https://github.com/ariefsaid/PMO/commit/9726ee129442e95731151d864b9faf3f718d4bdc))
* **ui:** retain the compact product mark on phone list headers ([9446405](https://github.com/ariefsaid/PMO/commit/94464053db9301fb02f8b732df0baa20b72c355a))
* **ui:** show non-valued expense reviews with a dash ([e1f9c14](https://github.com/ariefsaid/PMO/commit/e1f9c148b31c139eba3843a6f1ac6e88cd7d806f))
* **ui:** simplify empty billing breakdown and template actions ([28d44a8](https://github.com/ariefsaid/PMO/commit/28d44a8d6dea18b30d100930d87b69ec4bfff1f4))
* **ui:** simplify empty consumption message ([04acf96](https://github.com/ariefsaid/PMO/commit/04acf96c9d2d6fd3e293782971bc45eb2a68f1b7))
* **ui:** simplify the empty claims register ([a23bc78](https://github.com/ariefsaid/PMO/commit/a23bc78dd7af8a097334bca1779b2a4820f52778))
* **ui:** soften calendar lines and give empty agendas a next step ([a60edec](https://github.com/ariefsaid/PMO/commit/a60edec0bacc41cc471643fee0487fc07fcd38d5))
* **ui:** spell out phase lateness consistently ([e4ca644](https://github.com/ariefsaid/PMO/commit/e4ca644e29681097cac84134241d8bbd75f7f90e))
* **ui:** stretch the phone task queue controls ([a208d11](https://github.com/ariefsaid/PMO/commit/a208d11e5fb484beb432708425d2f2b5c232c34b))
* **ui:** use English tax labels consistently ([bd69731](https://github.com/ariefsaid/PMO/commit/bd6973128426767d731682586d97d76a8bca17b8))
* **ui:** use shared budget version picker ([7f415ea](https://github.com/ariefsaid/PMO/commit/7f415ea54e39da33f62ca5c9798225503c1586a3))
* **ui:** use shared document filter controls ([90d465e](https://github.com/ariefsaid/PMO/commit/90d465e4cf7b4343eb209d6106e8ffd1e98ba383))
* **ui:** use the supported claim form grid layout ([47fd1d3](https://github.com/ariefsaid/PMO/commit/47fd1d3d800e631eca142da550dd5ec5b2d4d4b2))
* **ui:** wrap bounded list filters beside toolbar actions ([d7dffeb](https://github.com/ariefsaid/PMO/commit/d7dffeb5a5e594c0c4bfa9b3df8e78b6b4658593))
* wait for accounting documents before showing procurement figures ([67a6ee9](https://github.com/ariefsaid/PMO/commit/67a6ee90d77dc035212d1456819aedd2f6419a41))
* work order journeys click the first New work order action on an empty list ([f7f1619](https://github.com/ariefsaid/PMO/commit/f7f161901a76eea21f887b22a8a2db8dd913d2bd))
* work order journeys on an empty list ([faa4149](https://github.com/ariefsaid/PMO/commit/faa4149f7177481009f957a4cdf2175aba532b20))
* **work-orders:** separate money figures and retain tablet register ([c55f62f](https://github.com/ariefsaid/PMO/commit/c55f62fb33c58fe321df4d447bb5d285e09046f4))


### Performance

* batch management pack project rollup reads ([a0a8a9a](https://github.com/ariefsaid/PMO/commit/a0a8a9acdc12fa12fc226a17d49b984ff64ad66c))
* import entry UI primitives directly (initial JS 2.15 to 1.79 MB) ([1fa15c0](https://github.com/ariefsaid/PMO/commit/1fa15c010e00ac36c117f488b507ea1f31fcf305))
* load repository domains on demand (initial JS 2.38 to 2.15 MB) ([727dd3d](https://github.com/ariefsaid/PMO/commit/727dd3d6110b8e86b17d685a69aa74cb43666746))
* project statements start loading with the page, not after the money reads ([1726346](https://github.com/ariefsaid/PMO/commit/1726346d52ab0554ecf1634425b423285cd34919))
* read the management pack in one request ([0e1ab89](https://github.com/ariefsaid/PMO/commit/0e1ab892e337c22f6e7f11746d42dda7adce698b))
* shared table, rail and tabs stop doing layout work on every screen ([f971c06](https://github.com/ariefsaid/PMO/commit/f971c0669e6645dda833be9be3293f2651473e0d))
* **shell:** defer record indexing and scope title observation ([3733791](https://github.com/ariefsaid/PMO/commit/3733791f4d2cadfbf0de02781c0c5e5bef405775))

## [0.45.0](https://github.com/ariefsaid/PMO/compare/v0.44.0...v0.45.0) (2026-11-25)


### Features

* acceptance journeys for the contractor test script, the fixes they found, and three carried branches ([1d82602](https://github.com/ariefsaid/PMO/commit/1d8260200d82cbb0c3164d1748dfa5928b9d89ef))
* allow surveyors to read validated report revenue ([26b5375](https://github.com/ariefsaid/PMO/commit/26b53753726fb47f8b535ca02b3a47fdce96ea48))
* **attendance:** an un-recorded crew member reads Not yet present, never present by default; the person's manager may mark them ([#2882](https://github.com/ariefsaid/PMO/issues/2882)) ([57ca82d](https://github.com/ariefsaid/PMO/commit/57ca82df06fc5851a8b820c633bf7a9a371692e3))
* **attendance:** the manager recorded on a person marks that person's row and reads the record ([#2882](https://github.com/ariefsaid/PMO/issues/2882)) ([88212e8](https://github.com/ariefsaid/PMO/commit/88212e8e00bfbae4e85e02f8c6b119b9d0b7a18f))
* **billing-steps:** skipping a work-order billing step records a reason ([#2880](https://github.com/ariefsaid/PMO/issues/2880)) ([efb9798](https://github.com/ariefsaid/PMO/commit/efb979800a8518c5e3f38d792a8987bfd1d68a79))
* buyer quoted route, hourly rental checks, claim evidence reuse ([cef37ad](https://github.com/ariefsaid/PMO/commit/cef37ad28aa1c5b86bb326eb99741569f51ec8b8))
* check hourly equipment rental with proven downtime ([acf2f5c](https://github.com/ariefsaid/PMO/commit/acf2f5caeec7cfe92758a9b72dcf4960fd21fd20))
* daily report crew link, head-count evidence, areas and rates, management views ([58374fa](https://github.com/ariefsaid/PMO/commit/58374fa334971076c9e09339d04e3d747cc85f06))
* equipment officer registers assets; project control reads rates ([76d16db](https://github.com/ariefsaid/PMO/commit/76d16db3875161908c73bdc355928dc6d831b445))
* **equipment:** the Equipment Officer enters rental terms when registering a rented asset and edits them (DD-R1124-17) ([16b5d9c](https://github.com/ariefsaid/PMO/commit/16b5d9c4349d66f4ec64b44024f4882078e66e99))
* grant scoped equipment and catalogue job rights ([42a8ff9](https://github.com/ariefsaid/PMO/commit/42a8ff9d939bbe0b39e503667f10e3c7b9634666))
* leave by line manager, consumables plan approval, inspection purchase approval, close-out documents ([3cde6a7](https://github.com/ariefsaid/PMO/commit/3cde6a761af3180c52d586fc06a313cc68c95e70))
* let Buyers submit approved equipment-plan purchases safely ([4cbca2b](https://github.com/ariefsaid/PMO/commit/4cbca2bc32c5915a2ae269b649e0bdc1d29c7578))
* **material-usage:** issued material raises both warning levels and warns the responsible person and the manager ([#2884](https://github.com/ariefsaid/PMO/issues/2884)) ([2bba0ac](https://github.com/ariefsaid/PMO/commit/2bba0ac0f27b3a7cf723ecdda0b030b380d8c077))
* **my-work:** a field account reads its own notices on My work ([#2887](https://github.com/ariefsaid/PMO/issues/2887)); requester's Unit price column follows price visibility ([#2789](https://github.com/ariefsaid/PMO/issues/2789)) ([6158848](https://github.com/ariefsaid/PMO/commit/6158848bfe4140dd29628c3eb41858db32a5386d))
* nobody is present by default; a person's manager may mark their attendance ([e0e04c7](https://github.com/ariefsaid/PMO/commit/e0e04c734db7b21f00ebe625bb8453ff45cf1fee))
* overdue filter on My Tasks; record history names the actor's role ([0388382](https://github.com/ariefsaid/PMO/commit/0388382ac27a31127b1728267c6f64166b15f3e2))
* per-work-order cloud folder and scoped project-admin document upload ([85cc022](https://github.com/ariefsaid/PMO/commit/85cc022fe7132d9e82fd4add688d926e38b1caf7))
* **projects:** show work in hand and capacity months under projects and dashboard ([8c2a81c](https://github.com/ariefsaid/PMO/commit/8c2a81cfb1954e809df74aeb84dbfcfbe7d72851))
* quality check on receipt for flagged items ([50d85ce](https://github.com/ariefsaid/PMO/commit/50d85cec77f1edc46bf9ce88adc847fda83e23b0))
* receive goods against the purchase order (per-organisation setting, default off) ([d6b5a04](https://github.com/ariefsaid/PMO/commit/d6b5a0489e5c6013ef7d24ed4cc79b725b5d6366))
* role rights for planning, project control and equipment jobs ([082afaa](https://github.com/ariefsaid/PMO/commit/082afaaddab90bcfcf678e4d9b6026a6bf93a3c3))
* stock handover proof, material completion, needed-by date, work-order import, opening balances, role follow-up screens ([d8ecc1f](https://github.com/ariefsaid/PMO/commit/d8ecc1f5aed54d2832fcd2f4e266972905b7d94e))
* stock issued to a work order counts as its cost (per-organisation setting, default off) ([b1a49e4](https://github.com/ariefsaid/PMO/commit/b1a49e4f556e3d4685b6780db3e32f1a2a278d85))
* **stock:** attribute count differences to work orders ([c95ec90](https://github.com/ariefsaid/PMO/commit/c95ec9011f42e1602a6ce8460f44a10e79495403))
* **stock:** order receiving read says which lines need a quality check (D4) ([f27ff52](https://github.com/ariefsaid/PMO/commit/f27ff5242328d6c8a2f6f88175ec394c9222f592))
* **stock:** receive form and order receiving ask for passed and rejected on flagged items; the receipt shows them (D4) ([f1ac5b9](https://github.com/ariefsaid/PMO/commit/f1ac5b97dc41990515a366069423032716729cf8))
* surveyor reads the priced daily figure; buyer submits plan-generated purchases ([5dca7f0](https://github.com/ariefsaid/PMO/commit/5dca7f03462c5c06b90847374a62a035ce806e36))
* **tasks:** a task made from an issue links back to it in My Tasks and the Tasks tab ([0699eda](https://github.com/ariefsaid/PMO/commit/0699edaa909c657ac96d4282217e94ede724adcd))
* the Equipment Officer registers a rented asset and its rental terms ([46b74fe](https://github.com/ariefsaid/PMO/commit/46b74fe28ca227a5b9aaba986da09fcfc6e8a233))
* work order on timesheet review, standard item picker, live task history ([ceca78c](https://github.com/ariefsaid/PMO/commit/ceca78c685958ff671077e61436230fec961930f))
* **work-orders:** capture the client's order as a Draft with checks as tasks ([d4dc3f9](https://github.com/ariefsaid/PMO/commit/d4dc3f9364e5e29c1787c0923cd976c777ba6325))
* **work-orders:** capture the client's order as a Draft with checks as tasks ([da1c4d0](https://github.com/ariefsaid/PMO/commit/da1c4d0ecaf26e58d68fe9d02da897a72b895cf6)), closes [#2898](https://github.com/ariefsaid/PMO/issues/2898)


### Bug Fixes

* **#2897:** a photo refused on a submitted site report says the rule, and the upload path closes ([e7ba63a](https://github.com/ariefsaid/PMO/commit/e7ba63a8645377e5a119e8430c1038018e8072c3))
* **#2905:** the task-to-issue link is named by its visible words; the Tasks tab stops repainting rows on drawer open ([d09d96b](https://github.com/ariefsaid/PMO/commit/d09d96ba3f11c1604bcf532f2c358b42ce0cf812))
* align issue task permissions and scoped acceptance fixtures ([12e933b](https://github.com/ariefsaid/PMO/commit/12e933b0cefc26e01751c01632c46f7457c840a4))
* align release journeys and preserve decision record access ([43151f4](https://github.com/ariefsaid/PMO/commit/43151f46070466da1e60f9c9f8934aa23ca9c85e))
* align rental checks with catalogue and fixture contracts ([18d3b68](https://github.com/ariefsaid/PMO/commit/18d3b68d78da695497319c8ca00853e0773ee385))
* align requester navigation across the rail and palette ([201af5f](https://github.com/ariefsaid/PMO/commit/201af5f551878d8224f47b0f5405e87a429d0e12))
* allow issue reporters to record open issue follow-ups ([63fd19d](https://github.com/ariefsaid/PMO/commit/63fd19dc9f0b62d8ad63a7fdc5f9c82caa0a6ce3))
* billing board totals read as money; project portfolio shows contract value and billed ([43b45c9](https://github.com/ariefsaid/PMO/commit/43b45c9e1ffdf55c9f982cbb74201e45a33e84af))
* **billing:** the deep-link stage prefetch adds no provider requirement beyond what BillingTab already had ([#2893](https://github.com/ariefsaid/PMO/issues/2893)) ([a01f4c1](https://github.com/ariefsaid/PMO/commit/a01f4c1ff529800cb160f99e2715b71600bc77ef))
* buying and billing role jobs found by the acceptance walk ([87ae75a](https://github.com/ariefsaid/PMO/commit/87ae75a95307aa3996e7b290b5586e4133211e8b))
* carry rental invoice disputes to Finance review ([0f0c4d4](https://github.com/ariefsaid/PMO/commit/0f0c4d48be4a893acd016c395c8eac7c6261fca4))
* complete management role paths and label revenue comparisons ([ebe843e](https://github.com/ariefsaid/PMO/commit/ebe843ecbd334c21ae65e938ed42717bdeba8d89))
* complete order receiving CI contracts and role journey ([1135c6f](https://github.com/ariefsaid/PMO/commit/1135c6ffbf63dd1f86c87bd4e8927461ed5aca41))
* complete people document and stock role workflows ([6466c8a](https://github.com/ariefsaid/PMO/commit/6466c8ac917478db690bd1155d96b66b57f84f96))
* complete receiving rollback and buyer role proof ([cb62684](https://github.com/ariefsaid/PMO/commit/cb626844b8e5e6834206b9476baf279772dd23a8))
* complete role journeys and lock checklist ownership consistently ([36037d6](https://github.com/ariefsaid/PMO/commit/36037d69c2421543110b5d1f82e14e4efc55d2de))
* **crews:** the default day is the organisation's, not the browser's ([5ec7917](https://github.com/ariefsaid/PMO/commit/5ec791717642b54993891af8ab0d32a7e95637c7))
* **crews:** today comes from the organisation's timezone, not the browser's ([#1126](https://github.com/ariefsaid/PMO/issues/1126)) ([0be19d2](https://github.com/ariefsaid/PMO/commit/0be19d210dc178cf5f1043bb6622b3275b034614))
* **dashboard:** PM Waits on you shows billing steps waiting on their role ([#2886](https://github.com/ariefsaid/PMO/issues/2886)) ([64b0efa](https://github.com/ariefsaid/PMO/commit/64b0efafbc8907f0a2edb49ada5ea030c893f23c))
* document locale metadata and claim evidence journey ([ab7c08e](https://github.com/ariefsaid/PMO/commit/ab7c08ea07a04c88b2ade0258d60d32845b5dded))
* **e2e:** satisfy strict typecheck in JOB-BQ13 and JOB-PU14 ([f6f7cfb](https://github.com/ariefsaid/PMO/commit/f6f7cfbe445e192d68bd297050365e5743581c80))
* **earned-billed:** the panel re-asks a refused money read once instead of pinning restricted until a reload ([#2896](https://github.com/ariefsaid/PMO/issues/2896)) ([36f2484](https://github.com/ariefsaid/PMO/commit/36f248483a25da1ba266eabbd403f2ae81b590ad))
* equipment hire cost without a connected accounting system ([6ed563e](https://github.com/ariefsaid/PMO/commit/6ed563eb13dba34bd66e2ef0d8c07978d836f2f8))
* **equipment:** distinguish split usage approval and input labels ([d6a978c](https://github.com/ariefsaid/PMO/commit/d6a978cb617e4660cf368de96bd8c82dadc0f8b4))
* **equipment:** hourly rental compare sends no empty invoice id ([#2889](https://github.com/ariefsaid/PMO/issues/2889)) ([3fe8ecd](https://github.com/ariefsaid/PMO/commit/3fe8ecd7e04e877df2e64cb0f6e532a5efbeb2e1))
* **equipment:** hourly rental compare sends no empty invoice id ([#2889](https://github.com/ariefsaid/PMO/issues/2889)) ([d1ff2f2](https://github.com/ariefsaid/PMO/commit/d1ff2f2ff49c7e18915ed1d2f27f503536e3297c))
* **equipment:** rental terms are entered on rented machines; the officer is not offered the form on an owned one ([9a0eef2](https://github.com/ariefsaid/PMO/commit/9a0eef2a27a42a24f8a0c65341ba457ea7915d6f))
* **equipment:** save daily work-order usage slots atomically ([68cc5fa](https://github.com/ariefsaid/PMO/commit/68cc5fa83ebb1bc752767c02c6bbf32d250892e4))
* **equipment:** vendor response cards draw their heading ([#2890](https://github.com/ariefsaid/PMO/issues/2890)) ([1b6496c](https://github.com/ariefsaid/PMO/commit/1b6496c1484a69da11f17dd2c9026f84b62358bd))
* four small fixes and the three red journeys of the release run ([e6f51b3](https://github.com/ariefsaid/PMO/commit/e6f51b3ba8d75bc36f78b3702da2b892364bd54f))
* **history:** saving a project, company, contact or purchase refreshes its History in place ([#2888](https://github.com/ariefsaid/PMO/issues/2888)) ([d6cb867](https://github.com/ariefsaid/PMO/commit/d6cb867ae2f9dd41b3ce7bb75e0a59d1fbcd8839))
* honor purchase read-only state in subcontract details ([7c0b7e1](https://github.com/ariefsaid/PMO/commit/7c0b7e17f4b5841c41e1dc4c75002d826006bb27))
* **i18n:** cancel catalogue reads when a document departs ([5794c78](https://github.com/ariefsaid/PMO/commit/5794c78f2a40cd0cc81231554f68c5e705b9eaa6))
* **i18n:** coalesce catalogue-loaded notifications and batch on-demand namespace loads ([908509f](https://github.com/ariefsaid/PMO/commit/908509fa593589a90b5e210f0d96c0d3e83637ae))
* **i18n:** coalesce catalogue-loaded notifications and batch on-demand namespace loads ([ca10e5b](https://github.com/ariefsaid/PMO/commit/ca10e5bb1eb414aa24da7c20c402df3970d2cd8e))
* integrate stock setup scope and settings catalogue ([42b09fb](https://github.com/ariefsaid/PMO/commit/42b09fbfa37f260e7f20dafb03526c4e5bd418e2))
* keep saved rental checks quiet before asset selection ([0fd4513](https://github.com/ariefsaid/PMO/commit/0fd451354521535d8acaa62c24680c4279bba10e))
* let buyers source quotations and follow supplier visibility ([67f7459](https://github.com/ariefsaid/PMO/commit/67f745981c7552e960e83124c1aa8be9af1ec76f))
* line-item price input stays editable while prices are hidden; My work notices load every fetched page ([9107900](https://github.com/ariefsaid/PMO/commit/910790010fca466cc288f60ddf7f15cc08d9c3db))
* list the QS report revenue switch in organisation settings ([d9e1314](https://github.com/ariefsaid/PMO/commit/d9e131424d808f0bdcf9b3a565f38e4914903809))
* load report setting translations and isolate role fixture claims ([3450b31](https://github.com/ariefsaid/PMO/commit/3450b31af2b2ee191da82b9969cbe3698083572f))
* make management views an organisation setting ([3c47b49](https://github.com/ariefsaid/PMO/commit/3c47b491e2d9c8466271f361913cd00ad2a99721))
* make site role actions and evidence available in their workflows ([2f892ae](https://github.com/ariefsaid/PMO/commit/2f892ae4c6a6edef9e2233daee949cad958042e8))
* management and project-control role jobs found by the acceptance walk ([441dd26](https://github.com/ariefsaid/PMO/commit/441dd260de4c8f797247895f02944566084f33ea))
* order lines show their stored description; a cloud upload refreshes the linked folder panel; folder journey no longer reloads ([2a4144e](https://github.com/ariefsaid/PMO/commit/2a4144eb09017eaf94ffabb1559d59db9bd71b76))
* preserve exact area rate decimals ([2a41842](https://github.com/ariefsaid/PMO/commit/2a41842d24c6ecae1327af7f26ce586460c7607e))
* preserve light, active-member, and mutation guards on WO folder PR ([af88bff](https://github.com/ariefsaid/PMO/commit/af88bff52ca44e4cd894d92a40a7736a407f0394))
* preserve rental basis boundaries and shared controls ([ec55552](https://github.com/ariefsaid/PMO/commit/ec555520c84e951adf9fb4f1ffb79aa3f79b9b19))
* preserve the resolved locale during pending language switches ([5d7eac3](https://github.com/ariefsaid/PMO/commit/5d7eac36b809b8cd3939216a8a13ac02a1eb4605))
* preserve view-only controls and strengthen site workflow proof ([6d31998](https://github.com/ariefsaid/PMO/commit/6d319983c347117c31676446846a0980af6f52b0))
* **procurement:** expose read-only case inspection for procurement managers ([c08f11c](https://github.com/ariefsaid/PMO/commit/c08f11c1f6e3b19dec98b6eadeb8302569cb3fd5))
* **projects:** a pending search write no longer drags the user back to the list after a record opened; split the shared-evidence journey ([6a87e87](https://github.com/ariefsaid/PMO/commit/6a87e870c4feb90b23ba824342306b9450abd6fb))
* **projects:** address M8 work-in-hand review findings and sync origin/dev ([e9e1db8](https://github.com/ariefsaid/PMO/commit/e9e1db80ccf88110a061782e89e425d55ac49c79))
* **purchasing:** the pay stage reads paid from the purchase status when payments are not readable ([#2892](https://github.com/ariefsaid/PMO/issues/2892)) ([54115b0](https://github.com/ariefsaid/PMO/commit/54115b0dfb17772efabbc1005c1123341f605773))
* **quantity-changes:** version history shows the request's reason ([#2883](https://github.com/ariefsaid/PMO/issues/2883)) ([3d28cbc](https://github.com/ariefsaid/PMO/commit/3d28cbc986638d541bd413926e985d1cb48f5287))
* reconcile people lane CI gates ([1e2ef11](https://github.com/ariefsaid/PMO/commit/1e2ef114641abea7cd1bde28799477873a6dbb9e))
* refresh persisted rental warnings after recording checks ([32981de](https://github.com/ariefsaid/PMO/commit/32981de81433e535a26d9f21c84c2e9b1659987e))
* release browser reds, approver keeps reading decided purchases, language race ([0fa5928](https://github.com/ariefsaid/PMO/commit/0fa59288c935829bf914b00d1c16641a16a3b9bb))
* resolve document language before catalogue completion ([6a71dcd](https://github.com/ariefsaid/PMO/commit/6a71dcd318501bb232ba9b1386caeaa9097f7620))
* show native equipment costing setup without an accounting catalogue ([61468a6](https://github.com/ariefsaid/PMO/commit/61468a6e4e45d591f6d211290b3888fb30e14290))
* site role jobs found by the acceptance walk ([15b6ff6](https://github.com/ariefsaid/PMO/commit/15b6ff633a40ac63656766eeb7729cd04259026e))
* split equipment hours per work order; procurement manager reads purchase cases ([d3fa022](https://github.com/ariefsaid/PMO/commit/d3fa022d48331f44ea1e51a3056a4b88d994e31c))
* **stock:** a work order's stock panel on its own page so stock roles can read it ([#2885](https://github.com/ariefsaid/PMO/issues/2885)) ([e950283](https://github.com/ariefsaid/PMO/commit/e9502837232f841b70cec3d4171ff76f58de948e))
* **stock:** the quality-check refusal names no screen; a pickup says it cannot be recorded as one; note-length cases (D4) ([05ac120](https://github.com/ariefsaid/PMO/commit/05ac1206d820a8ecdb5db0dc64c3c98d34d83531))
* stores and people role jobs found by the acceptance walk ([b8e7ca1](https://github.com/ariefsaid/PMO/commit/b8e7ca10882bae1bbc56fd4e0356a93fda93bf1b))
* support legacy accounting dates and declared setup capabilities ([eb47860](https://github.com/ariefsaid/PMO/commit/eb478609eae9de3659b3f21df1a61c43aa5658d6))
* the ordering right reads goods receipts on the purchase checklist ([e5d867c](https://github.com/ariefsaid/PMO/commit/e5d867c2342accc952a23bb423c6c68441b7ce3a))
* **work-order:** inspections overdue and planned date use the organisation's day ([#1126](https://github.com/ariefsaid/PMO/issues/1126)) ([2e1f3e1](https://github.com/ariefsaid/PMO/commit/2e1f3e19817f0baf6dcec0ebeee39c871f25b475))
* **work-orders:** price approved expense claims on the work order cost list ([#2891](https://github.com/ariefsaid/PMO/issues/2891)) ([9a3be8f](https://github.com/ariefsaid/PMO/commit/9a3be8fab3337ea6742948aa2a0ccf3c412128e1))
* **work-orders:** sections take today from the organisation's day; three journeys follow ([bdd8a54](https://github.com/ariefsaid/PMO/commit/bdd8a54a496333ae94756667b5c24f40a4ae09a3))
* **work-order:** today comes from the organisation's timezone on safety records, crew link, survey and billing steps; journeys follow ([#1126](https://github.com/ariefsaid/PMO/issues/1126)) ([3ebc624](https://github.com/ariefsaid/PMO/commit/3ebc62440dfa6c995c3611483d547e4e93b01839))


### Performance

* **billing:** a deep-linked claim starts its billing-stage read with the tab's own reads ([#2893](https://github.com/ariefsaid/PMO/issues/2893)) ([5031313](https://github.com/ariefsaid/PMO/commit/5031313013a91295309fb5687e941339c7b3a5ec))

## [0.44.0](https://github.com/ariefsaid/PMO/compare/v0.43.1...v0.44.0) (2026-11-23)


### Features

* a project with a linked folder opens Documents on the folder tree; the card heading names the view; register journeys choose Register as a step ([b05da57](https://github.com/ariefsaid/PMO/commit/b05da57644a11c1d605bbeb1dd8f0ed73577ce61))
* **approvals:** add operational requester who-next for work-order issue, purchase receipt and transfer receipt (source-only, UNTESTED) ([d67a547](https://github.com/ariefsaid/PMO/commit/d67a5472b92725ad8a6c4d809528027f25e97e13))
* **approvals:** add requester who-next role tokens and alternativeRoles seam (source-only, UNTESTED) ([b87c085](https://github.com/ariefsaid/PMO/commit/b87c085cb89e6f8ea98af56ab1de2b768b3772b4))
* **approvals:** add requester who-next waiting indicators for plans, replenishments, limits, and invoices (source-only, UNTESTED) ([d4e8a24](https://github.com/ariefsaid/PMO/commit/d4e8a2410d20de4b0630c7e152b2d1d59b2e863e))
* **approvals:** compute the requester who-next route for site cash (source-only, UNTESTED) ([af2379e](https://github.com/ariefsaid/PMO/commit/af2379e8344c7beb861e4d2ba386347d8c719931))
* **approvals:** implement requester who-next on DSR, QCR, and Certificate screens (source-only, UNTESTED) ([9ced321](https://github.com/ariefsaid/PMO/commit/9ced3215954e83b37013ee1e3fab671551cc1e5e))
* checklist target dates and overdue markers on the close-out and clearance screens ([#2800](https://github.com/ariefsaid/PMO/issues/2800)) ([5687bb9](https://github.com/ariefsaid/PMO/commit/5687bb96b02f5d28d58f2ef8f059c1be6c646009))
* **db:** align stored person files with the medical rule; ordering by built-in role counts holders of the named role ([1ff0dcc](https://github.com/ariefsaid/PMO/commit/1ff0dccfec36cca39810cbdd70b3647aa5cbd4e3))
* **equipment:** a Submitted plan says who it waits for, from the database's own approval route (1565, source-only, UNTESTED) ([9e55b32](https://github.com/ariefsaid/PMO/commit/9e55b3238196092379ba8ed9631681fceb409ac1))
* **i18n:** approval notification reader-language localization for timesheets (fix-waiting 4) (source-only, UNTESTED) ([ad82664](https://github.com/ariefsaid/PMO/commit/ad82664dd347264bef5a88600e979a29aa61a39e))
* **import:** localize template example human names and descriptions for people and stock ([1469406](https://github.com/ariefsaid/PMO/commit/1469406a8dd4fedfefcc6991151cd148bce77527))
* locale-vs-registry guard with allowlist and self-test, wired into check:guards ([#2799](https://github.com/ariefsaid/PMO/issues/2799) slice A) ([51fb8eb](https://github.com/ariefsaid/PMO/commit/51fb8eb2d5fe7e7ee4c0f88a151f15f814b5a263))
* **material-requests:** show real job role names on detail; localise leave approver roles ([#2799](https://github.com/ariefsaid/PMO/issues/2799)) ([8624d38](https://github.com/ariefsaid/PMO/commit/8624d38ca84748899bb0f606e1f2516ff63097cb))
* project documents tab shows the linked Microsoft folder as a folder tree ([6254ce7](https://github.com/ariefsaid/PMO/commit/6254ce7b1c12d72c9fe66b7f8b635ec61eec523c))
* renamed terms and role names reach the delivery note, purchase order and stock transfer prints ([d8252fd](https://github.com/ariefsaid/PMO/commit/d8252fd3d467e17abb0a04cb6774bc3fa7fd830e))
* Return is disabled with the same reason on a week the viewer recorded ([d0866e7](https://github.com/ariefsaid/PMO/commit/d0866e78c5e1503f18e77e67fc713d0210578a44))
* **site-reports:** typed route seam for the DSR validation projection (FR-WAIT-006) (source-only, UNTESTED) ([ff45006](https://github.com/ariefsaid/PMO/commit/ff45006a410f934fe37ffac868fbe92d70c0022c))
* **stock:** rename reach for stock transfers, stock returns and checkpoints ([#2799](https://github.com/ariefsaid/PMO/issues/2799) slice B1) ([81b6d85](https://github.com/ariefsaid/PMO/commit/81b6d850cdc0d3d47d07a16b684ec931888c4618))
* **survey:** rename reach for the survey quantity ([#2799](https://github.com/ariefsaid/PMO/issues/2799) slice B3) ([24b66e9](https://github.com/ariefsaid/PMO/commit/24b66e965696586d9672797455600521c5ad16cd))
* task outline strings in English and Bahasa; the cycle refusal sentence; drop the old parent-picker strings ([d5fea55](https://github.com/ariefsaid/PMO/commit/d5fea55b7abeee4e3200ddb01888ec8fb335a136))
* task outline: groups and phases added in place, subtasks typed in the task form and saved in one go, indented collapsible list and timeline with parent roll-ups, move a task ([6a3642d](https://github.com/ariefsaid/PMO/commit/6a3642d0be4f008fffd940907ae56dedd5c353d3))
* terminology registry, 23 new rename keys (1903), overrides read sized to the registry ([#2799](https://github.com/ariefsaid/PMO/issues/2799) slice A) ([3a9f00d](https://github.com/ariefsaid/PMO/commit/3a9f00d261ff6f9f966c2e2bea9974458de948c8))
* the week-approval list disables Approve on a week the viewer recorded; journey approves as a different manager ([c9cffd6](https://github.com/ariefsaid/PMO/commit/c9cffd66bc7552237e24275c2fa6c40b2086ab8e))
* **timesheets:** name who a submitted week waits for (1564, FR-WAIT-006) (source-only, UNTESTED) ([afdcf52](https://github.com/ariefsaid/PMO/commit/afdcf52d402c349fa142920b63179b840a9ea7d8))
* **types:** add operational waiting route RPC signature (exclusive seam) (source-only, UNTESTED) ([7cb3bac](https://github.com/ariefsaid/PMO/commit/7cb3bac559ab77ec91da7990f889ec3c3a3d7548))
* work-order dashboard with progress, cost, billed and missing per work order, and a work orders tab on the project page ([6ebddaa](https://github.com/ariefsaid/PMO/commit/6ebddaa3f62e554dbba39d66f55515e197e7875e))


### Bug Fixes

* absence reports read by the person's own crew; equipment rights follow the Equipment Manager job role; location allowed site-wide ([253e955](https://github.com/ariefsaid/PMO/commit/253e955cd1f3aae433b48bee583f789593d5e253))
* **admin-users:** truthful invitation outcome copy for post-send and unconfirmed failures (fix1122 invitation defect 2) ([75bef55](https://github.com/ariefsaid/PMO/commit/75bef55d3b554d290439bf0f48b9e8c2ef2cac95))
* align refusal and order wording ([b7945f8](https://github.com/ariefsaid/PMO/commit/b7945f8feeb3a4b7371906d5a1679da246d00024))
* Approvals entry follows decision standing (stable fact; keeper added in 1652) ([519fd7e](https://github.com/ariefsaid/PMO/commit/519fd7e13b7e9bb346321ca2fd067bbdfb94791a))
* **approvals:** close S1-S3/Q1-Q3 inbox knownness with scoped states, truthful counts and hermetic fixtures (source-only, UNTESTED) ([ac485be](https://github.com/ariefsaid/PMO/commit/ac485beaf4d8df37e26232873ef1a2d3f508ad7c))
* **approvals:** close the cash requester-route review (source-only, UNTESTED) ([3a282bc](https://github.com/ariefsaid/PMO/commit/3a282bc5f06aca54944b5dd9abd4baec91b34bd1))
* **approvals:** complete transitive mocks, LeaveRequestRow fixtures, and cached row error notice (source-only, UNTESTED) ([910c53c](https://github.com/ariefsaid/PMO/commit/910c53c578d69d70ed0053e9789d2bb27173f861))
* **approvals:** correct operational who-next to the 1560 assignment (source-only, UNTESTED) ([0b3125f](https://github.com/ariefsaid/PMO/commit/0b3125f76cc7908cae2185fb836c085c819028de))
* **approvals:** drop unused roleAdminExec key and guard waitingRoleLabel exhaustively (source-only, UNTESTED) ([747f704](https://github.com/ariefsaid/PMO/commit/747f704a3fee0c29f58022fe5f7cca7354655c8a))
* **approvals:** require canonical waiting.count for all-caught-up and retain extraKinds on pending/error (source-only, UNTESTED) ([199fb7f](https://github.com/ariefsaid/PMO/commit/199fb7fdeea5d11237e38cc71125569cb571e12a))
* **approvals:** reuse existing approvals.queue.loadErrorSub key for scoped errors (source-only, UNTESTED) ([ebb0a97](https://github.com/ariefsaid/PMO/commit/ebb0a974e469c1583fdb3704125ecb487ff8d1ed))
* **approvals:** type DOM lookup sites with closest&lt;HTMLElement&gt; in waitingKinds suite (source-only, UNTESTED) ([0100aa6](https://github.com/ariefsaid/PMO/commit/0100aa6f3728368380183bf7be7fcd62e6670f7b))
* browser journeys: exact names for controls that share a word, valid class code in the head-count fixture, expiry journeys in the serial lane, leave journey archives the person it creates ([105c91d](https://github.com/ariefsaid/PMO/commit/105c91d43a20c7e60334f6e06330c3e921ea4ccd))
* **clearance:** drop the unused useClearanceEnabled import ([e588644](https://github.com/ariefsaid/PMO/commit/e5886444a0505432fe3e67f21611589fbfddb082))
* **closeout:** type the open-due paged read off the generated query ([7a2da17](https://github.com/ariefsaid/PMO/commit/7a2da171048933d34552bb1e1727ef03bb5a33d8))
* **company-dashboard:** mount WorkOrdersTile for Executive, Admin, and Finance company home ([1df5e9b](https://github.com/ariefsaid/PMO/commit/1df5e9b7f3a1d3496fa90e624fd2372e8a387ca0))
* **dashboard:** expose check-ins-waiting row on company home for eligible roles ([357dfad](https://github.com/ariefsaid/PMO/commit/357dfad56cd60635454c050c267be067368f6581))
* **db:** a field account is never named as a plan approver (source-only UNTESTED) ([247237f](https://github.com/ariefsaid/PMO/commit/247237f9bbe50e594d0f8af1e20122535eb26eb6))
* drop shadowed CORE_ROUTES keys; count the approvals queue roster (PR2803) ([09f05ee](https://github.com/ariefsaid/PMO/commit/09f05eeb6e2833273ea2611f641c504ea33948a3))
* **e2e:** find the Crews reject prompt as the alertdialog it is ([7be2838](https://github.com/ariefsaid/PMO/commit/7be28383ebd70ca18d92c0b4ae1e047c674ceb01))
* **e2e:** keep PCI and PU21 teardown out of finally (source-only, UNTESTED) ([f75201a](https://github.com/ariefsaid/PMO/commit/f75201a3226f93d9adba12e1ca7a118d2040b033))
* **equipment:** the empty route says no one CAN approve, not that no one is set up ([34ad2db](https://github.com/ariefsaid/PMO/commit/34ad2dbd0bc70d99ba191d240bb49ac1c43b3995))
* **equipment:** the waiting line never contradicts a failed read (source review closure, source-only UNTESTED) ([b013720](https://github.com/ariefsaid/PMO/commit/b013720116fb2e5c239f3c5f6a80c7226c25b097))
* folder tree loading line uses the shared shimmer ([4859a54](https://github.com/ariefsaid/PMO/commit/4859a54ac7010ef2acf22034b0d6ab9a7d2fdb83))
* **i18n:** localize QCR client-decision bodies, prove exact user reason bytes, gate producer body literals (source-only, UNTESTED) ([3a8d642](https://github.com/ariefsaid/PMO/commit/3a8d642d412e45620513e9f4325e6be10a37c505))
* **i18n:** never localize a rejected timesheet body; approval/awaiting only (root ruling R-4, source-only UNTESTED) ([9d1ebe7](https://github.com/ariefsaid/PMO/commit/9d1ebe76553b6553312aa1a4a1a075fee5b70e47))
* **i18n:** route literal approval notification bodies and localize QCR sentences (fix-waiting 4) (source-only, UNTESTED) ([a1f3f58](https://github.com/ariefsaid/PMO/commit/a1f3f58685184519726235b1859a1cbd0e50c25d))
* **i18n:** the Indonesian final-BAST stage word is "akhir" (UNTESTED) ([164ac80](https://github.com/ariefsaid/PMO/commit/164ac804219410c9545ce93c136cb592bea3a803))
* isolation fixtures give the survey document its category; regenerate database types after the access fixes ([483fc3f](https://github.com/ariefsaid/PMO/commit/483fc3f8485afdce59915474cb1e04b2d47deb79))
* nested group label lines up with task names ([30c8d2b](https://github.com/ariefsaid/PMO/commit/30c8d2b63d3f3a0f2363f493084d0594ef1491ea))
* one requester wording and one Approvals-entry rule after the waiting-list merge ([4e860a9](https://github.com/ariefsaid/PMO/commit/4e860a93c204fa8003757ff61bcaaf3a53adc3d5))
* page shared waiting decisions completely ([698a10a](https://github.com/ariefsaid/PMO/commit/698a10a078c3656e5b386606f145d498ced4f9f5))
* people, pay-time, labour cost and release rules are enforced in the database ([10b6da7](https://github.com/ariefsaid/PMO/commit/10b6da7b6f49977ae8802616cf63d46fc4c8a1af))
* **people:** clarify MarkLeft date label as first day off crew roster ([6a5ea24](https://github.com/ariefsaid/PMO/commit/6a5ea247fd96fab163f0538accbbff09532907cd))
* **people:** keep a cleared MarkLeft day blank and require a real day (source-only, UNTESTED) ([19a8c84](https://github.com/ariefsaid/PMO/commit/19a8c84c77790e93bac0cef2662259341ce579b3))
* resolve the four round-1 integration defects ([ccaa11e](https://github.com/ariefsaid/PMO/commit/ccaa11e197b16a59cc0e113158c1452d88b8196a))
* roll-up cells read their own strings; test fixture matches the task shape ([b35b12f](https://github.com/ariefsaid/PMO/commit/b35b12f3a64a47dc576f05b7f161659a972e819a))
* scope BAST claim starts to their work order ([16d08c8](https://github.com/ariefsaid/PMO/commit/16d08c809ee937a6db67c4be02ebee0f73a13e3c))
* settings merge follow-ups (safety menu hook keeps the shared switch cache; refusal sentence in the switch test) ([d610324](https://github.com/ariefsaid/PMO/commit/d610324eb9fc1d413d85745afef44984081b0dce))
* **settings:** Finance keeps the done-not-claimed reminder in the plan dialog; idle-cost journey restored on its goal; orphan keys of removed cards deleted ([#2746](https://github.com/ariefsaid/PMO/issues/2746)) ([445a48b](https://github.com/ariefsaid/PMO/commit/445a48bf0cecfb4a0ad1366f4f3df1f78f87876d))
* show read failures instead of hiding or zeroing (medical releases, manpower needs, reviewer roles, line work orders); count medical releases waiting; Users directory manager name by manager_id ([5bd45c6](https://github.com/ariefsaid/PMO/commit/5bd45c68010fe94f83561ce951a94ba5420ed569))
* **site-reports,qcr:** close the requester review — server-proved DSR who-next, one honest QCR line (FR-WAIT-006) (source-only, UNTESTED) ([7076360](https://github.com/ariefsaid/PMO/commit/70763604265ca97c5eb6cb04025c8f578fade6e5))
* **site-reports:** keep the known route when only a background refetch fails (source-only, UNTESTED) ([fa943c3](https://github.com/ariefsaid/PMO/commit/fa943c326c78a9502c94f962b9fdcab6cbd757c6))
* **site-reports:** speak the PM's own role and keep honest uncertainty on a failed refresh (FR-WAIT-006) (source-only, UNTESTED) ([9a040e7](https://github.com/ariefsaid/PMO/commit/9a040e78145b8a21565c7726d1c8957f196c8c87))
* stock settings section keeps one name after the module-card move ([efbc7ec](https://github.com/ariefsaid/PMO/commit/efbc7ecf051ee420f8fe9a1fad22f91c36b3bc28))
* **stock,crews:** mark client material on read screens, guard the two-step send, correct the partial-loan warning ([a30dcf2](https://github.com/ariefsaid/PMO/commit/a30dcf264e9f10f1ff8920a3bcd85f6aacb851f1))
* **stock:** keep the configured tag on never-stocked below-reorder rows ([8e9576a](https://github.com/ariefsaid/PMO/commit/8e9576ae2577191eded81d019ec3d202409c1b04))
* **subcontract-certificates:** memoize query fallbacks and disambiguate new certificate button query ([956cf7d](https://github.com/ariefsaid/PMO/commit/956cf7d418b1ec07ec0cb7e42a9572bba2c86797))
* **subcontract-certificates:** offer certificate creation for managing PM with eligible project ([bfdf645](https://github.com/ariefsaid/PMO/commit/bfdf6459fc9ea8ae2c62ef40dd50fcea3c7766d2))
* subtask rows stack inside the narrow form dialog; no leading gap on phone cards ([05709bb](https://github.com/ariefsaid/PMO/commit/05709bb1faeec07a75e714e83420f621b778b432))
* task form proof label, nested subtask guide line and field hints; timeline summary bars, wider tree pane, one-line date ranges; phone filters on full rows ([71e17d0](https://github.com/ariefsaid/PMO/commit/71e17d02096973aa1edbedf6b90cd672720712ad))
* task outline dialogs keep the save error on screen; leaf wording in help corpus and glossary checks; isolation manifest lists the subtask-place backfill ([023c04a](https://github.com/ariefsaid/PMO/commit/023c04abc536d8b7c89961c463895171a300a507))
* **test:** bind BAST waiting proofs to the intended contract (UNTESTED) ([e8e14ae](https://github.com/ariefsaid/PMO/commit/e8e14ae23af2c9bc7c1795525a3db1be2fda18a8))
* the idle-cost scope control lands in the Modules billing-extras card ([#2746](https://github.com/ariefsaid/PMO/issues/2746) home; ported from the removed IdleCostSwitch card) ([eb2598c](https://github.com/ariefsaid/PMO/commit/eb2598cb0f9fbcac1fdf1fad4d0246d5105a4f14))
* the waiting list asks the policy whether an Admin may decide any request ([ff50337](https://github.com/ariefsaid/PMO/commit/ff503379b94c16064c15d419927736126d9e456f))
* the waiting-list leave integration test mocks the medical release read ([62df88e](https://github.com/ariefsaid/PMO/commit/62df88ecdce7cf87f5656de0079931152922eaee))
* timeline status column fits the longest status; fold toggle sits beside the open-task button, not inside it ([5f67171](https://github.com/ariefsaid/PMO/commit/5f67171485a6aa2d934a7565511aa6821916c292))
* **timesheets:** close 1564 review gaps with named null-manager people and exact proofs (source-only, UNTESTED) ([6777edd](https://github.com/ariefsaid/PMO/commit/6777eddc492cfee3fb933f2f8a53e655ac014860))
* two tests follow deliberate wording changes (job role label, draft acceptance sentence) ([7d36eb8](https://github.com/ariefsaid/PMO/commit/7d36eb83afb190543cfd7357b30d8399252dfb53))
* typed org-wide work-order reads, columns that fit in Bahasa, no money strip on the project tab, word budgets for the two new routes ([60793fc](https://github.com/ariefsaid/PMO/commit/60793fc5710a828ea6f96904ecde0c9f0613072c))
* unit and lint failures on the union head: unused import in a guard script, medical release mock in the inbox and rail tests, Bahasa invoice word in the billed-per-month test ([a68270a](https://github.com/ariefsaid/PMO/commit/a68270abdb86b07b2ea6a9fdb8f505028342fca3))
* unit failures from the union: medical release section idles outside a query provider, copy and catalogue entries for the gap strings, card head action, module test stub ([a5906f0](https://github.com/ariefsaid/PMO/commit/a5906f04ead3c1180e5b620012c9c4c0867378aa))
* use consistent order confirmation wording ([4d93d99](https://github.com/ariefsaid/PMO/commit/4d93d995b108ab2f65bfe3aff3d4e710f5b9f8bd))
* waiting-list reads use the generated types ([5cadf3f](https://github.com/ariefsaid/PMO/commit/5cadf3f2be4efc0abe0b13bfbf9b6c608f71af96))
* **waiting:** carry the typed line-manager display seam only (source-only, UNTESTED) ([9beaf25](https://github.com/ariefsaid/PMO/commit/9beaf2565ca871381675277a0ffda2a852ddedc2))
* **waiting:** name the real approvers of a native Draft customer invoice ([c7f0530](https://github.com/ariefsaid/PMO/commit/c7f0530fb0e616201f24ed4af0c6627cdad677d4))
* **waiting:** pin route error states and give the line-manager token a typed display seam (source-only, UNTESTED) ([2cd13b4](https://github.com/ariefsaid/PMO/commit/2cd13b416f5fa20554bc388d30b21539a020a393))
* work-order summary strip heads the dashboard and project tab with late and over-budget counts that filter, two-line money cells, unnumbered rows lead with their title, stat tile container on the frame ([86f74dd](https://github.com/ariefsaid/PMO/commit/86f74ddb12cf54c79b9923c3e6e6cda9319c2f66))
* work-order tab in the project tests' tab order, status labels from existing catalogue keys ([df512bf](https://github.com/ariefsaid/PMO/commit/df512bf42e50093d3c53f7e549db6aa41be12e17))
* **work-orders:** preselect only open issued work orders in CostAttributionFields ([551e377](https://github.com/ariefsaid/PMO/commit/551e377c4674e1a55b4fcac30da7420bfe67c575))


### Refactors

* file sizes format through the shared format seam; folder notices keep full width on a phone; empty folder line on the heading edge ([b68c052](https://github.com/ariefsaid/PMO/commit/b68c052656417c7e547cd9450a0795b15cb1a309))
* task outline helpers in their own modules (lint clean) ([669762e](https://github.com/ariefsaid/PMO/commit/669762ef05373eed3cf2306cd87c200cb92e8af1))

## [0.43.1](https://github.com/ariefsaid/PMO/compare/v0.43.0...v0.43.1) (2026-11-21)


### Bug Fixes

* align paid invoice drawer details ([04a5ac2](https://github.com/ariefsaid/PMO/commit/04a5ac202f3f8c6b2fb79d71de8bd6493a06b65f))
* clarify paid invoice details ([85c8663](https://github.com/ariefsaid/PMO/commit/85c8663f9944dbff90e8a3fcf3fb8f4dda814457))
* clarify unavailable payment dates ([0f4b82d](https://github.com/ariefsaid/PMO/commit/0f4b82df011ce5ac331669a238193a6cbae5f76a))
* **finance:** show paid wording, amount, and date on paid sales invoice ([#2442](https://github.com/ariefsaid/PMO/issues/2442)) ([800d053](https://github.com/ariefsaid/PMO/commit/800d05304d6f744f29fbf0a2e615c2087042abcd))
* **finance:** show paid wording, amount, and date on paid sales invoice ([#2442](https://github.com/ariefsaid/PMO/issues/2442)) ([1672fe2](https://github.com/ariefsaid/PMO/commit/1672fe279d3601ade1b948ab348918d9aed88930))
* keep paid invoice delivery evidence and align payment wording ([61c683a](https://github.com/ariefsaid/PMO/commit/61c683a7f78f241f83a02f5d21c80ae747051597))
* scope invoice drawer receipt read ([c2eaeee](https://github.com/ariefsaid/PMO/commit/c2eaeee46febc918213ded638ac6070312b8892a))

## [0.43.0](https://github.com/ariefsaid/PMO/compare/v0.42.0...v0.43.0) (2026-11-20)


### Features

* **erp:** reconcile direct cost account requests by category ([#1599](https://github.com/ariefsaid/PMO/issues/1599)) ([4ab3ba8](https://github.com/ariefsaid/PMO/commit/4ab3ba8a864dc569fc3c6fb4f8200204ebffe308))
* Microsoft app setup card shows when values were last checked ([04b78c6](https://github.com/ariefsaid/PMO/commit/04b78c63ee405b5a79cffae9fd4b6d6e1fb341e9))
* **motion:** one set of motion tokens ([#2128](https://github.com/ariefsaid/PMO/issues/2128)) ([32cecc2](https://github.com/ariefsaid/PMO/commit/32cecc2b209b41d9946c63aea504144395997c84))


### Bug Fixes

* address round two proof findings ([7a15cc0](https://github.com/ariefsaid/PMO/commit/7a15cc0d3e1f80ace7c5596f8f4d56b065c1b9e5))
* align project row links in tests and peel newer migrations in 2195 rollback test ([6d98292](https://github.com/ariefsaid/PMO/commit/6d98292f42064bd528c4b947ad3297543a3620fb))
* **dashboard:** update row click targets from button to link in ExecutiveDashboard tests ([1e137fe](https://github.com/ariefsaid/PMO/commit/1e137feafe5bc3113dd66083bd57f15e825fbb13))
* **erp:** drop dead unusable-account branch; unresolved account reads as could-not-confirm in review list ([#1599](https://github.com/ariefsaid/PMO/issues/1599)) ([04153de](https://github.com/ariefsaid/PMO/commit/04153de04c36e18a9e2947adc09d4f9dc8b0bb82))
* **erp:** read the stored unusable-account sentence in Bahasa on both ECX4 surfaces ([#1599](https://github.com/ariefsaid/PMO/issues/1599)) ([83772b4](https://github.com/ariefsaid/PMO/commit/83772b482a8fb77cdf3e461b8907e146a44bac5b))
* **erp:** reconcile direct cost account modal errors and contract tests ([f732c79](https://github.com/ariefsaid/PMO/commit/f732c79dee3e48179d0538f29eac16867f2c1bf1))
* **erp:** refuse known-unusable duplicate accounts in plain words, hold only unreadable ones ([#1599](https://github.com/ariefsaid/PMO/issues/1599)) ([139d7ae](https://github.com/ariefsaid/PMO/commit/139d7aeda741296143855b0be92e4a714ec58ba1))
* **finance:** voided supplier bills no longer count as unpaid ([#2600](https://github.com/ariefsaid/PMO/issues/2600)) ([8c55b4b](https://github.com/ariefsaid/PMO/commit/8c55b4b8f9693f7023d8df0f69c4900a9c560135))
* **i18n:** align work order English keys ([7f7535a](https://github.com/ariefsaid/PMO/commit/7f7535ac9701a2752827621d7a94ad758d4bfcb4))
* **material-requests:** guard destinations and retry permission ([a442ccc](https://github.com/ariefsaid/PMO/commit/a442ccc2b22a80e584162cafa54b0278374b477e))
* money fixes from the testing round ([c4a5c7e](https://github.com/ariefsaid/PMO/commit/c4a5c7e0e2618f0e9dccb67a1282dffec29824a8))
* **opening-balances:** active member gate and stock wording ([af61ef3](https://github.com/ariefsaid/PMO/commit/af61ef30827d3fb2587f7d06f5c29e5d891b22da))
* release prep (isolation probe pk types, screen-check route ids, e2e preflight, job journeys) ([e7d706b](https://github.com/ariefsaid/PMO/commit/e7d706bd280b19387a0bf3159d64e81f43dfe883))
* retain document type administration ([a366a74](https://github.com/ariefsaid/PMO/commit/a366a74278f47042d3bbda46e82c116b97a03d23))
* retain work-order issue filter ([#2521](https://github.com/ariefsaid/PMO/issues/2521)) ([7ace8d7](https://github.com/ariefsaid/PMO/commit/7ace8d7215612e7cea36652a3a4797d9ab999ce6))
* stock ledger wraps long project codes instead of clipping ([202f107](https://github.com/ariefsaid/PMO/commit/202f107545464d30d044d086126775a172a9f832))
* stock ledger wraps long project codes instead of clipping ([73c3c15](https://github.com/ariefsaid/PMO/commit/73c3c15a68067111c71cb1139f12345d786ebd28))
* **test:** wrap ErpSetupChecklist in router, update project link selectors, peel opening balances in contract quantities rollback test ([e66ae9a](https://github.com/ariefsaid/PMO/commit/e66ae9a8725fbcf9442ea3a533bd37bd0b08f561))

## [0.42.0](https://github.com/ariefsaid/PMO/compare/v0.41.2...v0.42.0) (2026-11-20)


### Features

* **#1522:** daily site report data access, exact revenue and permission gates ([5dc0e04](https://github.com/ariefsaid/PMO/commit/5dc0e04d15e4992570982062e82a1aaefa063ef2))
* **#1522:** site report screens, validation queue and field journey ([7fc5bd8](https://github.com/ariefsaid/PMO/commit/7fc5bd8e489f2a36c34c41cd149320f850c7e629))
* **#2517:** cost attribution seam, shared work-order and discipline pickers, EN/ID strings ([d9d7896](https://github.com/ariefsaid/PMO/commit/d9d7896eb91704913e4e549f311f7a0bc79da68d))
* **#2517:** timesheet lines carry work order and discipline through the week save ([5f4e0ea](https://github.com/ariefsaid/PMO/commit/5f4e0eae01db989085c50bd2bfc5c63c096a24c6))
* **#2517:** work-order and discipline pickers on equipment, stock and purchase record forms ([3d869ab](https://github.com/ariefsaid/PMO/commit/3d869abdda0c147c68ad4762cd1b7f64b4d918eb))
* **#2518:** entry links to the work-order page, e2e journey, module-completeness marking ([befacff](https://github.com/ariefsaid/PMO/commit/befacff77c2e2adce31cb54c9e996ab6cb2160c5))
* **#2518:** work-order record page at /work-orders/:id (scope, costs, billing, documents) ([066cb81](https://github.com/ariefsaid/PMO/commit/066cb81b52a5812100aeb84dd09fa93a25ccf03e))
* **#2519:** plan vs actual card on the project's contract area, plan and split editors ([3b0cb7e](https://github.com/ariefsaid/PMO/commit/3b0cb7e28314230213e3730476c71af12cd756b6))
* **#2519:** plan-vs-actual data access, repository and hooks ([27f7562](https://github.com/ariefsaid/PMO/commit/27f756205ef6f602472be3a54d6907c36ae025d4))
* **#2519:** pure plan-vs-actual allocation and roll-up with Layer-1 money tests ([7c1934d](https://github.com/ariefsaid/PMO/commit/7c1934d3cd61053180662d5b080308c2f73baa0f))
* **#2521:** issue log UI, hooks, locales, tests and e2e specs ([99de14c](https://github.com/ariefsaid/PMO/commit/99de14c9572b0702e49f66843f1f4b7d4a558b59))
* **#2521:** shared FileInput, retention entry for the escalation job, bounded file list ([b8ae472](https://github.com/ariefsaid/PMO/commit/b8ae4727505a3887f5fc29b977d4689ef33c7020))
* **#2523:** stock for site work - yard/staging, stock tags with zero-cost rule, document attachments, balance per work order ([9dc1fbb](https://github.com/ariefsaid/PMO/commit/9dc1fbb98d02e4e89efd7e42f21166602cff13c3))
* **#2524:** material request repository, plan status and refusal helpers, can() gates ([4b328e3](https://github.com/ariefsaid/PMO/commit/4b328e36c072c6129dfa04d8f5471f5f4562b5a6))
* **#2524:** material request screens, hooks, nav and en/id strings ([e538c3b](https://github.com/ariefsaid/PMO/commit/e538c3b0ff46ff4f2538eac893b67bb94a786c9d))
* **#2524:** material request tests, AC-MRQ-015 journey, distinct rail icon, plan notes ([035b531](https://github.com/ariefsaid/PMO/commit/035b5315e21bd86efee374ec9ff39652f2825fd2))
* **#2524:** plan read for the request form; database types for material requests ([5a928bf](https://github.com/ariefsaid/PMO/commit/5a928bf1733e835b2ddb2cf973313d6cf7e46718))
* **#2527:** expiring documents list screen, repository seam, en/id strings, retention entry ([baacb24](https://github.com/ariefsaid/PMO/commit/baacb2409a712d1cf4ddc44ec37adea596fe4d83))
* **#2528:** crews and attendance data layer, repository, hooks, role-matrix entries and tick model ([f5a631e](https://github.com/ariefsaid/PMO/commit/f5a631edc286c8a0ef70258094c8f4e1c7755140))
* **#2528:** Crews in the canonical navigation order; crews type without created_by ([398b76e](https://github.com/ariefsaid/PMO/commit/398b76ed854344e290bbec644c139491e25e552b))
* **#2528:** Crews page — crew master and membership, work-order roster with shortfall, attendance tick and no-login week approval (EN/ID) ([0d8b147](https://github.com/ariefsaid/PMO/commit/0d8b1473cdb94173fa51877785f1f32d025043e5))
* **#2529:** material request is a renameable organisation term (EN/ID, singular/plural) ([6f0fcc9](https://github.com/ariefsaid/PMO/commit/6f0fcc9d5d8980a7514e61dad4bb8f4fcde32208))
* **#2542:** add, edit and archive expiring documents on equipment and person records ([652ef36](https://github.com/ariefsaid/PMO/commit/652ef36b547f8d57945e438cbd725da0825fb531))
* **#2542:** expiryDocument policy, attachment bucket migration 0994 and pgTAP ([15541d5](https://github.com/ariefsaid/PMO/commit/15541d5ab45418dcd1e3f4a1b0ee7cecc00081b2))
* **#2542:** People register e2e journey, nav test update, glossary, strings in the administration namespace ([5699c68](https://github.com/ariefsaid/PMO/commit/5699c6847b8f2dc5ea34b5751083fff7a977cb06))
* **#2542:** People register nav test updates and one-line empty state ([620884a](https://github.com/ariefsaid/PMO/commit/620884a4b6def70deff2e60f5d568580dc9d5753))
* **#2542:** People register under Administration (add, edit, archive, link to app user) ([7acd7d7](https://github.com/ariefsaid/PMO/commit/7acd7d774814a7ed388601af37602e33283dfd23))
* 15 Dec work-order map landing (21 branches) ([d71cca3](https://github.com/ariefsaid/PMO/commit/d71cca3ca0b27acddef233be86ea46785fff9e03))
* **billing:** Billing terms dialog sets the stage list, invoice deadline and retention ([#2522](https://github.com/ariefsaid/PMO/issues/2522), [#1572](https://github.com/ariefsaid/PMO/issues/1572)) ([e77be2a](https://github.com/ariefsaid/PMO/commit/e77be2ac56f2dfb70da52b42c051476b473b7135))
* **billing:** billing-stages DAL and repository seam ([#2522](https://github.com/ariefsaid/PMO/issues/2522)) ([9af8c9f](https://github.com/ariefsaid/PMO/commit/9af8c9f53480359d71c67282b99af77d67515b0e))
* **billing:** claim drawer shows and records billing stages, deadline and retention held ([#2522](https://github.com/ariefsaid/PMO/issues/2522)) ([6888fed](https://github.com/ariefsaid/PMO/commit/6888fed3ce02bc6b119fbec03012d13048e4593c))
* **billing:** stage age and monthly invoice deadline arithmetic; DB types for billing stages and retention ([#2522](https://github.com/ariefsaid/PMO/issues/2522)) ([d7fc629](https://github.com/ariefsaid/PMO/commit/d7fc629325e4da20a7646b34829749115a7cd9c2))
* **budget:** Budget tab and Administration read the PMO fiscal calendar ([#2329](https://github.com/ariefsaid/PMO/issues/2329)) ([9448615](https://github.com/ariefsaid/PMO/commit/944861586dd693c6ef670937474239856a04288e))
* **i18n:** org terminology settings screen, post-processor and hard-coded-term guard ([#2529](https://github.com/ariefsaid/PMO/issues/2529)) ([c68dada](https://github.com/ariefsaid/PMO/commit/c68dada30269a16352d69a66e619cdd9ada159bd))
* **i18n:** org terminology table, RLS proof and override engine ([#2529](https://github.com/ariefsaid/PMO/issues/2529)) ([dcf5665](https://github.com/ariefsaid/PMO/commit/dcf56654e23ee58ffd2b3c311ad48ba8ff22065d))
* material requests with role approval chain ([180a4c4](https://github.com/ariefsaid/PMO/commit/180a4c475104a4e88e6a4fce3ee10e3ebca50fb9))
* preview linked project evidence ([d090882](https://github.com/ariefsaid/PMO/commit/d09088226c90d51dfbc2dd57d9d8cf90aae2deaa))
* **receivables:** phone cards and record drawer keep project manager and delivery context ([#2564](https://github.com/ariefsaid/PMO/issues/2564)) ([d9d6b4c](https://github.com/ariefsaid/PMO/commit/d9d6b4c52be0adc473c63553c8fa62a2b9205fb8))
* timesheet save feedback, receivables context, unit coverage ([831f27a](https://github.com/ariefsaid/PMO/commit/831f27a9d4b8cbdbcb98dc66d126c9f49916ee32))
* **timesheets:** explicit weekly save states (invalid, saving, failed, unsaved, saved) and invalid-aware week switch ([#2559](https://github.com/ariefsaid/PMO/issues/2559)) ([35c7034](https://github.com/ariefsaid/PMO/commit/35c7034581be56a062006078e80af0ca96962104))
* work order and discipline on every cost line ([277d9a2](https://github.com/ariefsaid/PMO/commit/277d9a292e59907b640ecec1aceff06d38fc2197))
* work-order plan vs actual and shared cost split ([f807a4b](https://github.com/ariefsaid/PMO/commit/f807a4b9b22aa580a329875bb4b8c230385b9c73))


### Bug Fixes

* **#1522:** site report record page layout (one left edge, no single-line sections) and list word budget ([ab26294](https://github.com/ariefsaid/PMO/commit/ab26294dd2f05a1bd3aee142ee7bb0118e818b29))
* **#2517:** move cost-attribution strings to a workOrderCost namespace; static refusal keys ([947ba37](https://github.com/ariefsaid/PMO/commit/947ba370c6ce3801269aa27b20c045d8ff80fa05))
* **#2523:** complete site stock workflow and ledger safeguards ([da21dbb](https://github.com/ariefsaid/PMO/commit/da21dbb86c1933d3f687f228539a4fdae316788f))
* **#2523:** compose work-order stock panel (one heading, units, phone cards, plain labels, zero-cost wording) ([f00987d](https://github.com/ariefsaid/PMO/commit/f00987dbaddd09304c6e20da1e1d8244ac1ee9f7))
* **#2523:** shorter moved-elsewhere label so the header fits ([71f8131](https://github.com/ariefsaid/PMO/commit/71f8131804d2aa2a1fb66ea461a915bcf416f737))
* **#2523:** unit once, beside the on-site quantity ([921d627](https://github.com/ariefsaid/PMO/commit/921d627015113f93e5f7329ef93b01dcb8a6b3aa))
* **#2524:** request events always carry a to-status; declare their retention ([f1100a2](https://github.com/ariefsaid/PMO/commit/f1100a2437fbab244b4e16bc178f221ed32ba286))
* **#2524:** waiting queue shows request past the list page, cut-off refusal names time and date, stand-in revoke errors shown ([24e9c61](https://github.com/ariefsaid/PMO/commit/24e9c61a0c6356fa06c5743abd30b9b37b129d83))
* **#2528:** attendance approval list names each line's work order (JOB-H8) ([f6bf81d](https://github.com/ariefsaid/PMO/commit/f6bf81dfdb2c5f61086f9be639212cad8343aa37))
* **#2528:** New crew stays in the header on every view so the tab bar keeps one position (R3) ([2553a05](https://github.com/ariefsaid/PMO/commit/2553a05707dd0e567ecdb4a11e8f3703d99de92f))
* **#2542:** explicit button variant and module-completeness registration for the person record ([fccc0dc](https://github.com/ariefsaid/PMO/commit/fccc0dce6e8fea6342a8add6e8fd8ec958437908))
* **#2571:** material request needed-by default in organisation calendar; cut-off control Admin only ([e0f35d8](https://github.com/ariefsaid/PMO/commit/e0f35d89820a05af55428406ed1d3da487e06168))
* approval routing counts recorded spending ([6e8dcef](https://github.com/ariefsaid/PMO/commit/6e8dcef60329cf3d238929c05129732b16a5ed14))
* Bahasa stock string says sisa not saldo; repositories test lists taskProof and listOpenByWorkOrder ([921e315](https://github.com/ariefsaid/PMO/commit/921e315f203dbf5485c47f31ea030a3082a60d01))
* **build:** place the landing's new files in their tsconfig projects ([#2317](https://github.com/ariefsaid/PMO/issues/2317)) ([0743855](https://github.com/ariefsaid/PMO/commit/0743855a44f65590393efb8fb13a6f4050e7720b))
* complete work order evidence and cost navigation ([5b569c9](https://github.com/ariefsaid/PMO/commit/5b569c90e5444fb27973c9ccb956bb853960fe6e))
* enforce material request submission and approval rules ([75412aa](https://github.com/ariefsaid/PMO/commit/75412aa560249a4c502c89061f7248ec0348d519))
* flag stale shared splits before costs exist ([765336a](https://github.com/ariefsaid/PMO/commit/765336a1ac195c33096c4e4f296585b21d8b43a8))
* **i18n:** avoid cascading terminology replacements ([a17b62a](https://github.com/ariefsaid/PMO/commit/a17b62aa63f364211df27d5f68fdf48194d626a7))
* **i18n:** Bahasa billing-stage copy keeps faktur for the tax invoice only ([e7b2488](https://github.com/ariefsaid/PMO/commit/e7b248858528f3649eaff1841f740683956b7281))
* **i18n:** Bahasa billing-stage copy keeps faktur for the tax invoice only ([86cb96b](https://github.com/ariefsaid/PMO/commit/86cb96b6975ea20d102ec3f42e50998691e0aefc))
* **i18n:** remove unused BAST document translation ([e915a37](https://github.com/ariefsaid/PMO/commit/e915a37b604a8a917b6be25adb782340b62d7dab))
* keep at-risk loading through initial list read ([3b6fb37](https://github.com/ariefsaid/PMO/commit/3b6fb37238c33def3beae8a01e7dc9687fd10edd))
* offer cost attribution for stock returns ([420b585](https://github.com/ariefsaid/PMO/commit/420b58575835fbff8c99445b567eabe6210ae954))
* preserve existing timesheet attribution on hour edits ([3241787](https://github.com/ariefsaid/PMO/commit/3241787b93ee1c203c1143f7fea4ce444567ba06))
* preserve list readiness per source ([a1923ce](https://github.com/ariefsaid/PMO/commit/a1923ce41b10508728f0d95e676fa07f233418b9))
* preserve unknown shared cost in work order margins ([00b2e25](https://github.com/ariefsaid/PMO/commit/00b2e2543b6c08612b5de14d5ac087144fa57fbe))
* **procurement:** include pending item on draft save ([c715e62](https://github.com/ariefsaid/PMO/commit/c715e620cf441bec8a30ebbca90126082fe5b63c))
* rate catalogue RPCs in ACL allow-list, 0950 plan count, WORP-003 header locator ([5f8a709](https://github.com/ariefsaid/PMO/commit/5f8a709ea4d8ff7b9a8a2ca870f38f93b3ae590b))
* read all saved work order split shares ([433a18f](https://github.com/ariefsaid/PMO/commit/433a18ff6fe28ca668923ee57542e2fea75ea597))
* refresh work order costs when records change ([348a88c](https://github.com/ariefsaid/PMO/commit/348a88cab46427c03f588185821dfd491afb8ea1))
* release e2e reds after the work-order landing ([277c2c8](https://github.com/ariefsaid/PMO/commit/277c2c86658b2f009850ef82033287aa50223ec7))
* resolve work order breadcrumbs and verify invoice journey ([3612965](https://github.com/ariefsaid/PMO/commit/36129653537869669475c2810c36ceec850a09e8))
* scope cost links by record source ([fc7ab43](https://github.com/ariefsaid/PMO/commit/fc7ab43b5d15eb4cbe7f05ca03557e801541831d))
* show claim terms without billing stages ([ffdde2c](https://github.com/ariefsaid/PMO/commit/ffdde2cf2e3d4e1628724a8a4a3b654337a2c67d))
* surface work order section read failures ([ad5c97d](https://github.com/ariefsaid/PMO/commit/ad5c97db06a53cedd85f9c01954aa4819ca1b8fe))
* **ui:** a notice never takes the control it covers ([d393718](https://github.com/ariefsaid/PMO/commit/d39371801e3688904cbd62d433d191e72b53c872)), closes [#2502](https://github.com/ariefsaid/PMO/issues/2502)
* work-order breadcrumb reads the Projects module label; org-terms baseline counts the material-request module label (translated from labelKey) ([ad51622](https://github.com/ariefsaid/PMO/commit/ad51622c407b944e81fab92c89b86c1ea7429ea4))


### Performance

* parallelize ERPNext census and party onboarding ([#2119](https://github.com/ariefsaid/PMO/issues/2119)) ([91fa3bc](https://github.com/ariefsaid/PMO/commit/91fa3bc24b85cc420de6ce2ce8d0665df91fa4dd))
* **rail:** defer overdue count until Finance intent ([bc2ad7f](https://github.com/ariefsaid/PMO/commit/bc2ad7ff56f83fc8ead713522ee4135902754d17))


### Refactors

* **#2519:** editor helpers live in the pure module (fast-refresh lint) ([1d1fbca](https://github.com/ariefsaid/PMO/commit/1d1fbca0d6cea2dfea51101dc83b95d1c6f865e3))

## [0.41.2](https://github.com/ariefsaid/PMO/compare/v0.41.1...v0.41.2) (2026-11-17)


### Bug Fixes

* **ui:** approvals budget figures on one grid (labels and figures share a line per row, two per row at 1024); purchases tabs stay on one line on phone and the selected tab scrolls into view ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([3ae7bb7](https://github.com/ariefsaid/PMO/commit/3ae7bb775688562edab12076c05975bc12f0353f))
* **ui:** demo screens redesigned for review; shared date field; Bahasa pass ([ea9bb89](https://github.com/ariefsaid/PMO/commit/ea9bb898b8f951de557e1d78d2922edbb98c5fae))
* **ui:** filter pickers show their own name until chosen, the count holds the row's end, board cards show the whole project name, context columns read grey ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([da696cb](https://github.com/ariefsaid/PMO/commit/da696cb00d23613045fa6f8bec534750fe77a31d))
* **ui:** finance dashboard's supplier-invoiced filter tests reach the status filter through the app picker; goals unchanged ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([130d1cf](https://github.com/ariefsaid/PMO/commit/130d1cfddd1c8ee9668a2fe99a9533d2ccf5fd9b))
* **ui:** home — second currency reads '+ USD 1,85 jt' under the rupiah figure, billing ranking bars drawn as labelled figures, engineer hours bar keyed under it, full phone targets ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([b8d11fd](https://github.com/ariefsaid/PMO/commit/b8d11fdb31068e2ba9252a911dc0360dbc1a5c54))
* **ui:** Needs attention is always a full-width band above Money position, so neither panel stretches around empty space ([d9cbc00](https://github.com/ariefsaid/PMO/commit/d9cbc0046be3089fc4479f4b89ac14391c196bf5))
* **ui:** phone tab layout check follows the one-line rule: tabs share a line, the selected tab is whole in view ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([33c4f4f](https://github.com/ariefsaid/PMO/commit/33c4f4f0d29fbfa37c05480eeb3b0bb0c9382936))
* **ui:** purchases journeys and layout check follow the app picker; drop dead next-step hook, orphaned keys and stale native-control allowlist ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([09f9ca2](https://github.com/ariefsaid/PMO/commit/09f9ca284c58a818eebb4557c2160937d52c9e76))
* **ui:** purchases list and approvals inbox redesigned ([eb667e4](https://github.com/ariefsaid/PMO/commit/eb667e4e22eea52055da8bd5c5e9ec2b67510792))
* **ui:** requester shows on the project purchases tab; phone cards name the requester once ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([f44868d](https://github.com/ariefsaid/PMO/commit/f44868d3775695785253346a0af1abdd7f65bc0f))
* **ui:** sentence-long statuses on the integration cards and embedded invoice rows wrap instead of being cut ([#2497](https://github.com/ariefsaid/PMO/issues/2497)) ([cdb67fc](https://github.com/ariefsaid/PMO/commit/cdb67fcddd03c54dc03a83e83409e73b116d0499))
* **ui:** the header identity line never leaves a separator dot at a line start or end (customer and project number on a phone) ([732f709](https://github.com/ariefsaid/PMO/commit/732f7094bd3bec98f4995893a6a4c65ad0854fa3))

## [0.41.1](https://github.com/ariefsaid/PMO/compare/v0.41.0...v0.41.1) (2026-11-16)


### Bug Fixes

* **procurement:** entry row Add button centres and the item table fits at 1024 ([2467c57](https://github.com/ariefsaid/PMO/commit/2467c57a5cc5245fd7b9e2be21aec129b539d115))
* **procurement:** entry row of the item table lines up on the new purchase form ([de6f99c](https://github.com/ariefsaid/PMO/commit/de6f99c38b5b315659a0bbd06ba414340b594d35))
* **procurement:** entry row of the item table lines up on the new purchase form ([d5035e2](https://github.com/ariefsaid/PMO/commit/d5035e26d605809d8f0dd0a6bcf4bad0fe3d9215))
* **ui:** a document preview opens as a large viewer dialog, not a side drawer ([37b7b6a](https://github.com/ariefsaid/PMO/commit/37b7b6ae2c60063b4860163a8866e48003332358))
* **ui:** a picker list may grow wider than its field so names are not cut ([0dbea63](https://github.com/ariefsaid/PMO/commit/0dbea63d61776cf5345445ad504208a7e7a13377))
* **ui:** a picker option keeps its code or tag on one line in its own right-hand column ([6e16037](https://github.com/ariefsaid/PMO/commit/6e160379c494f081cd648d6b0904e1635596a5ac))
* **ui:** Phase timeline spans the row and leaves no extra gap when its neighbour slot is empty ([5a61d37](https://github.com/ariefsaid/PMO/commit/5a61d3752caccbc3ee9bd247e1b3a3fd46b80e0d))
* **ui:** project header gets an identity line and a facts line; Updated moves to the right end ([93e1ff1](https://github.com/ariefsaid/PMO/commit/93e1ff198314b24894ddf43c7aee84ef55cdc163))
* **ui:** project header names the project on every width; status tags sit under the name where the row is narrow ([2ba6cdf](https://github.com/ariefsaid/PMO/commit/2ba6cdfd73686cefcb1e6b1932bbbcb00fb97fcb))
* **ui:** project Overview layout — My open tasks rows on the card inset, Needs attention rows keep natural height, Money position rows plain label and amount ([10a88b4](https://github.com/ariefsaid/PMO/commit/10a88b4fa8416ab15f903ac1f6b746615966487f))
* **ui:** the owner's pointed-out screen defects: overview, header, pickers, Stock tabs, document preview ([4034227](https://github.com/ariefsaid/PMO/commit/4034227d4d460b603445ae7816c41b6afc03dab2))
* **ui:** the Stock title and tab bar stay put from the list to a record, a count and a form ([b501af5](https://github.com/ariefsaid/PMO/commit/b501af5c0b6d8a939d95f8367e8427644c425db9))

## [0.41.0](https://github.com/ariefsaid/PMO/compare/v0.40.0...v0.41.0) (2026-11-16)


### Features

* **billing:** Billing tab bills, evidences, withdraws and invoices a claim in PMO when no ERP owns revenue ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([968b3ca](https://github.com/ariefsaid/PMO/commit/968b3caf3a082c432714e731792b932f2a6ca83a))
* **billing:** claim invoice copy, down-payment line names, spec, e2e journey ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([55e2f48](https://github.com/ariefsaid/PMO/commit/55e2f489bd19aa92f5b4b3b17276df6cb0fa2689))
* **billing:** invoice a progress or down-payment claim in PMO when no ERP owns billing ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([9c1fc89](https://github.com/ariefsaid/PMO/commit/9c1fc894fdd7d8c9be8a67f3a99b766700f23be4))
* **billing:** native claim invoice on the Contract tab claims card (New claim, evidence, Raise invoice, Withdraw); e2e journey ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([79ff122](https://github.com/ariefsaid/PMO/commit/79ff122c861562a5ab6154de4731760bf174e6d7))
* **cli:** pmo tm writes for rate cards, claims and sign-off prepare ([#1856](https://github.com/ariefsaid/PMO/issues/1856) base slice) ([a6beebc](https://github.com/ariefsaid/PMO/commit/a6beebc14a687579802aa37c8781e9b58c4646f7))
* **erp:** set ERP company default accounts and cost centre from PMO ([#1599](https://github.com/ariefsaid/PMO/issues/1599) slice 3) ([2fcb82e](https://github.com/ariefsaid/PMO/commit/2fcb82ee28acc2b0d26cae0347adb34366172d95))
* **journals:** manual journal entries with a maker and an approver, posted to the ERP ([#895](https://github.com/ariefsaid/PMO/issues/895)) ([c78bded](https://github.com/ariefsaid/PMO/commit/c78bded97b0313b3a106f5ee813c0efda48a451f))
* **journals:** save_journal_draft refuses an amount with more decimals than the organisation's currency holds, on create and edit; the form shows the refusal in English and Bahasa (part of [#2452](https://github.com/ariefsaid/PMO/issues/2452)) ([c00f56c](https://github.com/ariefsaid/PMO/commit/c00f56cceaffa539bc0c9dc88ee77b27cef63967))
* **procurement:** the approval panel names its figure and shows Budget used and the tender stage ([9056813](https://github.com/ariefsaid/PMO/commit/90568132c6b17de7f6dad488a1a1a6e6404c4a1a))
* **procurement:** wholeBudgetInputs picks spending and open orders once per basis ([3868ab8](https://github.com/ariefsaid/PMO/commit/3868ab80c49da9d915c9c6ebea8a6147b910b5f6))
* **stock:** request a purchase from low stock; purchase form returns to where it was opened; stock ledger and phone record title fixes ([7f43b42](https://github.com/ariefsaid/PMO/commit/7f43b424a90e09a769a1c3d1180be6a468048ede))


### Bug Fixes

* **#2249:** compact rupiah line wraps whole at phone width, never cut ([be07ba9](https://github.com/ariefsaid/PMO/commit/be07ba9fa8ee9a696f31c4a0c130951510b7a63a))
* **#2392:** assistant panel dock, history, new conversation, close, feedback and sr-only labels come from the assistantPanel catalogue (en + id) ([78996b4](https://github.com/ariefsaid/PMO/commit/78996b40e762df5fc020148d5f92d3aa460974fd))
* **2197:** count and adjustment loading reserve sized per state (no warehouse, warehouse, reopened draft lines) ([bb26294](https://github.com/ariefsaid/PMO/commit/bb26294fd423a538fa7d89fd11c6b58b4d1f4385))
* **2197:** plan field never shows a plan it has not read; stock line editor loading holds one line card's height ([f1df8e6](https://github.com/ariefsaid/PMO/commit/f1df8e649e7245fab7338d130f526cf83ddf8373))
* a pre-filled purchase form is not dirty until the person edits it ([89c3791](https://github.com/ariefsaid/PMO/commit/89c3791033bd6bc3868d6ce3e217d0cd5c31269f))
* **approvals:** "Left after this purchase" counts recorded spending and open orders, and the panel's figures add up ([af153ee](https://github.com/ariefsaid/PMO/commit/af153ee34af817e7c4e12b8a44d37ed2b92bb29c))
* **approvals:** the purchase budget panel names each figure and shows one Budget used ([#2406](https://github.com/ariefsaid/PMO/issues/2406)) ([b0f8674](https://github.com/ariefsaid/PMO/commit/b0f86747c67a2c7a8fb8acf534c226a23ecfb098))
* **assistant:** panel strings come from the assistantPanel catalogue (en + id); guard binds them ([#2047](https://github.com/ariefsaid/PMO/issues/2047), [#2392](https://github.com/ariefsaid/PMO/issues/2392)) ([bc52e44](https://github.com/ariefsaid/PMO/commit/bc52e449e810a33e65be684d65d69d377f5b33ad))
* **assistant:** the field stays editable while an answer streams; Enter waits, nothing sends by itself; placeholder invites the next question ([#2047](https://github.com/ariefsaid/PMO/issues/2047)) ([a2e3012](https://github.com/ariefsaid/PMO/commit/a2e3012be56cb68efc19b9a520c1a6e957631d8c))
* **batch:** regenerate tsconfig project lists; restore one-type supplier line on dev's one-line Purchases row ([f629c99](https://github.com/ariefsaid/PMO/commit/f629c995d7f98d4d3239725641dab11c946f924d))
* **billing:** [#1278](https://github.com/ariefsaid/PMO/issues/1278) round C — a phone preview card leaves out fields the row leaves empty ([ea1ea4a](https://github.com/ariefsaid/PMO/commit/ea1ea4a58b4829929389dcf65009ccc2f35af0a3))
* **billing:** [#1278](https://github.com/ariefsaid/PMO/issues/1278) round D — the preview leaves out a line already on the contract and says so ([7101dd1](https://github.com/ariefsaid/PMO/commit/7101dd1ca515168f1c8c0ece8e321cced0448a9c))
* **billing:** [#1278](https://github.com/ariefsaid/PMO/issues/1278) round E — already-there rows read neutral, failed rows say Not created, wider line-number column, one left edge, rate header aliases ([a5d9099](https://github.com/ariefsaid/PMO/commit/a5d90992201423cc2578079a88efc41c752354c8))
* **billing:** [#1278](https://github.com/ariefsaid/PMO/issues/1278) round F — already-there rows take a neutral mark, header matching reads both languages ([51c6fcf](https://github.com/ariefsaid/PMO/commit/51c6fcfb5cb9c092e3ba4f54b270005ee32cfbb5))
* **billing:** [#1278](https://github.com/ariefsaid/PMO/issues/1278) round F — the result title says complete only when every line was created ([f384b55](https://github.com/ariefsaid/PMO/commit/f384b55632162f2c3946288ddca08e0a0753ea00))
* **billing:** Raise invoice first in the claim row menu, none in the panel for a T&M claim; evidence note only while a claim lacks it ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([ffbc557](https://github.com/ariefsaid/PMO/commit/ffbc557ee2b5d65bfc3546f55d808b18c6d892f8))
* **billing:** review fixes for the native claim invoice: recover a PMO down payment after an ERP take-over, the ERP fence accepts the org's own item, in-flight ERP raise blocks the native invoice, unit on claim lines, gate nativeRaise on the route, specs ([#2465](https://github.com/ariefsaid/PMO/issues/2465)) ([7f972e2](https://github.com/ariefsaid/PMO/commit/7f972e240e3f8846749d03e69acd724b43869348))
* **budget:** drop the deleted BudgetSummary from tsconfig lists and its orphaned noActiveBudget string ([#2330](https://github.com/ariefsaid/PMO/issues/2330)) ([ec63891](https://github.com/ariefsaid/PMO/commit/ec63891cfb5ec0f2d2dd47544f4f7cac2475d5b8))
* **budget:** every rupiah equivalent is one unbreakable line; the figure strip widens to hold it ([1844465](https://github.com/ariefsaid/PMO/commit/1844465452549ca6361c3e61cf19533d175b64c0))
* **budget:** Forecast with no accounting system skips the fiscal calendar and the status pill never wraps ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([17dd3bf](https://github.com/ariefsaid/PMO/commit/17dd3bfd51d16003f03c7a0606deb825d2644839))
* **budget:** one Budget-used reader for header and card, no-budget says it once, equivalent never wraps ([e24cc47](https://github.com/ariefsaid/PMO/commit/e24cc477e94ca5b014158369bf48ef4b47f61e15))
* **budget:** one right edge for every money figure on phone cards ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([d831aa8](https://github.com/ariefsaid/PMO/commit/d831aa83bafc247ca63776a83ea6fc449d6e8a4a))
* **budget:** one unreadable category no longer turns every category to unknown ([#2330](https://github.com/ariefsaid/PMO/issues/2330), 0909) ([ae74393](https://github.com/ariefsaid/PMO/commit/ae7439325b08cf8711f0c86242bf416298e7b8d5))
* **budget:** recorded spending on the comparison with no accounting system; phone figures on one edge ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([09cfd64](https://github.com/ariefsaid/PMO/commit/09cfd64add59e9c33c74886f6593cfea64b17105))
* **budget:** restore dev's unmapped-categories note and uncategorized row after merge ([eb4efe7](https://github.com/ariefsaid/PMO/commit/eb4efe7752dc535639c22e277feefbd079b055e6))
* **budget:** rupiah equivalent on every foreign-currency figure; the Budget tab says once what is hidden ([1b140af](https://github.com/ariefsaid/PMO/commit/1b140af4e3162f74e09fd36ce35ef4e56c21c3e7))
* **budget:** the Overview note states the uncategorized amount with its currency and precision; shared UNCATEGORIZED constant; drop dead BudgetSummary ([#2330](https://github.com/ariefsaid/PMO/issues/2330)) ([caf8205](https://github.com/ariefsaid/PMO/commit/caf82053d0251aebe14cd70025c32c153fe012c6))
* **budget:** the spend-versus-budget comparison opens without an accounting system ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([f748c7a](https://github.com/ariefsaid/PMO/commit/f748c7add3f920e49b289a4033bd99709a2daaaa))
* **budget:** the table the Budget tab opens on shows paid spending per category without an accounting system ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([95962b1](https://github.com/ariefsaid/PMO/commit/95962b1d78cef9b5aae4a1319b75570d3f8ddb2b))
* **budget:** the Uncategorized row carries the paid spending with no budget category, so the rows add up to Spent ([#2330](https://github.com/ariefsaid/PMO/issues/2330)) ([8cdd124](https://github.com/ariefsaid/PMO/commit/8cdd12459663bd913030f56315430899ed4d49e1))
* **budget:** the Uncategorized row is not offered as openable, no date fragment for an unpaid category, phone figure aligned ([#2325](https://github.com/ariefsaid/PMO/issues/2325)) ([6302ea3](https://github.com/ariefsaid/PMO/commit/6302ea372dd656e8f92686b0fd04fd02e1eea2d8))
* **contract:** a project with no customer orders shows no order chain on the Contract tab ([d7e3ac1](https://github.com/ariefsaid/PMO/commit/d7e3ac12b5d7c1a724b7d216da24cc161ba69380))
* **contract:** no-orders lines table drops Ordered and Remaining; empty claims card names the ERP only when an ERP owns billing ([e8009cc](https://github.com/ariefsaid/PMO/commit/e8009cce7c181b58ee33c945ecb54fe41b54af4a))
* **erp:** a bill line whose item is on several order lines is matched to the one with its rate and quantity, else refused; zero, negative, null or empty quantity or rate refused ([4b0fc02](https://github.com/ariefsaid/PMO/commit/4b0fc022853bf21380400f3c8bd61e6cdee68ba5))
* **erp:** a bill with a missing rate or quantity keeps its existing refusal; the order is read only for a bill that has lines ([e4c6c2d](https://github.com/ariefsaid/PMO/commit/e4c6c2d14924a3ca86c177c923edfe50b8e0e9b6))
* **erp:** company accounts dialog reads refusals in Indonesian; Retry when the account lists fail to load ([#1599](https://github.com/ariefsaid/PMO/issues/1599) ECX-3) ([4568c80](https://github.com/ariefsaid/PMO/commit/4568c80d1a8a1f10ee30a5d91c623c3f8587e092))
* **erp:** every bill line, on the order or not, must have a numeric quantity above zero and a numeric rate of zero or more before any write; a unique rate picks the order line, quantity decides only among lines sharing the rate ([14fd4ef](https://github.com/ariefsaid/PMO/commit/14fd4ef9daa0875ced72cb6179daa56593e701d2))
* **erp:** every rebuilt vendor bill, with an ERP order or without one, must have a numeric quantity above zero and a numeric rate of zero or more on every line before any write ([c21f72f](https://github.com/ariefsaid/PMO/commit/c21f72f67a8853404a2576f5fb2fd39d9a700bc2))
* **erp:** keep the ERP's own reason under Bahasa after the translated refusal ([#2429](https://github.com/ariefsaid/PMO/issues/2429)) ([f7b8993](https://github.com/ariefsaid/PMO/commit/f7b8993ba44351608fd6721978bd0a925b29aa05))
* **erpnext-sweep:** retry waits, the budget's stage check and the hourly deadline fit the one deadline budget ([#2149](https://github.com/ariefsaid/PMO/issues/2149)) ([0eb0016](https://github.com/ariefsaid/PMO/commit/0eb00162a7d809543dc2ead227310a7fa773e4f4))
* **erp:** restore the no-English check at full strength; mark the ERP's own reason instead ([#2429](https://github.com/ariefsaid/PMO/issues/2429)) ([dc0e5a7](https://github.com/ariefsaid/PMO/commit/dc0e5a71bdf6e98199476b52f42b5b0430623d40))
* **erp:** say refused ERP sends in the viewer's language from the catalogue ([#2429](https://github.com/ariefsaid/PMO/issues/2429)) ([9257c01](https://github.com/ariefsaid/PMO/commit/9257c013c4ffce21901731e8d04026dd184a8800))
* **erp:** vendor bill lines carry their order line; PMO checks the amount left to bill ([a068571](https://github.com/ariefsaid/PMO/commit/a06857147fb7593515c34f8259b6890f4fde9e48))
* **erp:** vendor bill lines off the order carry no order reference; amount left adds up per order line; non-numeric qty or rate refused ([e78dec7](https://github.com/ariefsaid/PMO/commit/e78dec745abf1f655cf9c3ad124c06cf3699ed20))
* **erp:** vendor bills sent to ERPNext carry their order line; PMO checks quantities, rates and the amount left before sending ([6c6c435](https://github.com/ariefsaid/PMO/commit/6c6c43593ecb095e3d4c26a185aa9709709d5423))
* focus returns to More after phone drawer navigation; Contract tab without customer orders; AC-SCA-014 reruns ([c8b2c70](https://github.com/ariefsaid/PMO/commit/c8b2c70e2ea7bbe8521009f965b6289eb7aeec7f))
* **fx:** keep the equivalent's rate note on title and screen-reader text after the merge ([66af5c1](https://github.com/ariefsaid/PMO/commit/66af5c1a50bbd63cec55229f5cb072be2fe4a798))
* **journals:** a draft journal refuses amounts with more decimals than the organisation's currency ([4e99ae6](https://github.com/ariefsaid/PMO/commit/4e99ae6c2c55726bbb2926f857669b8e9701fea6))
* **journals:** the manual journal is a company-scoped ERPNext kind (a Journal Entry carries company); the canonical journal's header names no Odoo model ([#895](https://github.com/ariefsaid/PMO/issues/895)) ([7e03f8d](https://github.com/ariefsaid/PMO/commit/7e03f8d0048765eafe7d751ab055c63eaf5fac2b))
* **nbr:** drop a test id that duplicated the raise dialog's own (A7, [#2197](https://github.com/ariefsaid/PMO/issues/2197)) ([a69b0a0](https://github.com/ariefsaid/PMO/commit/a69b0a08986e9abb80e9a9082aff67e4f500add4))
* one name for returning a purchase, budget figures that fit, Projects opens on All when My Projects is empty; AC-NAR-003 step ([6552afe](https://github.com/ariefsaid/PMO/commit/6552afed5e041e5bdbaf018b780240fbde2422cb))
* phone bar height follows the safe area; pre-filled purchase form is not dirty; faster Documents test ([84912ba](https://github.com/ariefsaid/PMO/commit/84912baea64ad567be591216cdece0585b81b8c7))
* **procurement:** approval panel bar carries its own label, committed to purchases, never Budget used ([f333db2](https://github.com/ariefsaid/PMO/commit/f333db26b12abf69b3dda6e2395fc9d0f7b3c31f))
* **procurement:** approval panel figures line up across a row; the stage pill stays whole on a phone ([55aa679](https://github.com/ariefsaid/PMO/commit/55aa6791c965611760700d10cc161682b545da24))
* **procurement:** approval panel shows Left after this purchase over the whole budget; header line counts an order once; payments refresh spending ([6b54715](https://github.com/ariefsaid/PMO/commit/6b547151a283c4ce71b8b6982b8bf2a38162b840))
* **procurement:** approval panel shows open orders so the figures add up to Left ([a6d7bfb](https://github.com/ariefsaid/PMO/commit/a6d7bfb1b2a33de6aabe8844edb0d7b3fa429acd))
* **procurement:** back to dev's one-line code · supplier cell; number in the record-id type role, tests state the goals ([de71464](https://github.com/ariefsaid/PMO/commit/de714649b53a78852ceae10a695a7d506610f5cb))
* **procurement:** budget panel lays six tiles out as two rows of three ([769e2d8](https://github.com/ariefsaid/PMO/commit/769e2d8ef301fdd5891e4b3710fe476b8f16542e))
* **procurement:** Budget used draws no tile where the project header has none; inbox caption in tooltip; drop picker stage line ([c9f0b07](https://github.com/ariefsaid/PMO/commit/c9f0b07a1ae656b4be5c210d6ca897f713abe75d))
* **procurement:** budget-impact figures in the billions stay inside their tile at 1024 ([81283b4](https://github.com/ariefsaid/PMO/commit/81283b4587fb7ad06af5a5adb5c4933f68163d4c))
* **procurement:** Category 112px, rows no taller than before (title two lines, supplier line one), Next step wider, phone tabs wrap ([#1791](https://github.com/ariefsaid/PMO/issues/1791)) ([467c425](https://github.com/ariefsaid/PMO/commit/467c425531a13fa5d522f1399e358a5312047678))
* **procurement:** hide Void bill where an external system keeps the books; AC-SCV-009b calls the refusal directly; fixture org removed after the spec ([#1671](https://github.com/ariefsaid/PMO/issues/1671)) ([2c1bcd2](https://github.com/ariefsaid/PMO/commit/2c1bcd26c75611df9969f6e0afec761acdb5092d))
* **procurement:** keep the list within 1440 after widening the first column ([#2434](https://github.com/ariefsaid/PMO/issues/2434)) ([ed73f59](https://github.com/ariefsaid/PMO/commit/ed73f596b777ee6192ad3d3dec730eed50b94e2d))
* **procurement:** left after this purchase counts spending, open orders and reserved once (helper) ([dcc97eb](https://github.com/ariefsaid/PMO/commit/dcc97eb45015497fe63a900a6aa93395cc082bd4))
* **procurement:** Left reason fits one line: spending not known / open orders not known ([6acbf92](https://github.com/ariefsaid/PMO/commit/6acbf92f06a250c4ed49ae337ff77b9135ceb208))
* **procurement:** Left tile says Not known on one line; the sentence under it drops the repeat ([7466a9d](https://github.com/ariefsaid/PMO/commit/7466a9dd681fb76b37ac50c813266a31c15844d6))
* **procurement:** one name for returning a request: Return on the record page, a visible Return button in the list drawer ([f3f0c65](https://github.com/ariefsaid/PMO/commit/f3f0c65898ba3733ab06f0850919448ff08f17a4))
* **procurement:** Open orders sub-line says ordered, not yet in spending, true with and without an accounting system ([5c8f466](https://github.com/ariefsaid/PMO/commit/5c8f4663617ff97de394892054bc145e319cb3a7))
* **procurement:** ordered-purchase header line gives the amount without spending when spending is unknown ([97ba368](https://github.com/ariefsaid/PMO/commit/97ba368bb69c17b80b8b34462398b3f7d452289a))
* **procurement:** supplier room in first column, owner on own line on phone cards ([#2434](https://github.com/ariefsaid/PMO/issues/2434)) ([0a35ff5](https://github.com/ariefsaid/PMO/commit/0a35ff55e0228994b81a527733922996de847a16))
* **procurement:** the Category column fits its longest word, so a category never breaks mid-word at 1440 ([7806c63](https://github.com/ariefsaid/PMO/commit/7806c63b17c02c05ea479622d6e47ee9fc469a21))
* **procurement:** the supplier line keeps its two-line wrap; only the title truncates ([#1791](https://github.com/ariefsaid/PMO/issues/1791)) ([fb96296](https://github.com/ariefsaid/PMO/commit/fb96296b4707402f908eb3c2fd43941d5da918db))
* **procurement:** the tender stage reaches every budget panel mount; Bahasa wording on new keys ([e19f96f](https://github.com/ariefsaid/PMO/commit/e19f96ff97e208ad69e717023bff56d07613e17c))
* **projects:** an Engineer with no projects of their own opens the list on All, not an empty My Projects ([fa2d1c4](https://github.com/ariefsaid/PMO/commit/fa2d1c420d0a47e17a1018b4d8e852ce0b127d53))
* **records:** company activity and meeting header lead with facts, forms open from one action ([#2444](https://github.com/ariefsaid/PMO/issues/2444)) ([5f942ad](https://github.com/ariefsaid/PMO/commit/5f942adf5212e06d518e05e287e643d0d73edc2d))
* **reports:** count held contracts with no value beside Left to bill ([#2203](https://github.com/ariefsaid/PMO/issues/2203)) ([4672359](https://github.com/ariefsaid/PMO/commit/46723590d123ec8419fa81e13f113bcb9eb029f6))
* **reports:** Left to bill reads only the server's on_hand flag; drop the duplicate pack migration ([f2c087b](https://github.com/ariefsaid/PMO/commit/f2c087b4a3b32f934dc489b9ee3dc35f8ae8363b))
* **reports:** one Left to bill derivation for report tiles, rows and home ([#2203](https://github.com/ariefsaid/PMO/issues/2203)) ([9804736](https://github.com/ariefsaid/PMO/commit/980473633c0f44f58ca38a9c3045136d9b5e850f))
* **sales:** app stage moves equal the database's at Quotation and PQ Submitted ([#2379](https://github.com/ariefsaid/PMO/issues/2379)) ([b62c6a2](https://github.com/ariefsaid/PMO/commit/b62c6a2b5d7d0481f34c0cfade21b65b5e9c663a))
* **sales:** deal outcomes reachable on a phone ([#2389](https://github.com/ariefsaid/PMO/issues/2389)) ([291a3aa](https://github.com/ariefsaid/PMO/commit/291a3aad23c26e1d36b59972d5ba9d8b074da407))
* **sales:** the app's stage moves equal the database's at Quotation and PQ Submitted ([#2379](https://github.com/ariefsaid/PMO/issues/2379)) ([515701f](https://github.com/ariefsaid/PMO/commit/515701fc13f7273faedfda441cbcaa8ece605787))
* **shell:** drawer navigation returns focus to More even when the route commits after the drawer closes (AC-SHELL-001) ([987d797](https://github.com/ariefsaid/PMO/commit/987d79752b793725c9f8fbd24c5fb47cf69ed53c))
* **shell:** keep the phone-hidden record title one clipped line so no text sits under the bottom bar (AC-SHELL-002) ([201396c](https://github.com/ariefsaid/PMO/commit/201396cbfc938cbdf0ca343c0f57fc4146b897c7))
* **shell:** phone bar height follows safe-area padding; layout oracles skip text in a 1px clipped box (AC-SHELL-002, AC-MOBILE-OVERFLOW-001) ([6967641](https://github.com/ariefsaid/PMO/commit/696764171fc6ae451901459c94a02310710231d9))
* **shell:** the page reserves exactly what is fixed at the bottom, else the normal gutter ([#2353](https://github.com/ariefsaid/PMO/issues/2353)) ([6096d62](https://github.com/ariefsaid/PMO/commit/6096d62a4ae93afc5115ca2617d75f3a4133b5fd))
* **shell:** toast clears the pinned Approvals row under the nav drawer; bar labels measured whole at 390 ([#2353](https://github.com/ariefsaid/PMO/issues/2353)) ([9bd3c8f](https://github.com/ariefsaid/PMO/commit/9bd3c8fc73aba76a0ae3f715249a4633cf8f5849))
* **stock:** Bahasa says sisa for stock on hand in the stock list, reorder list, setup and messages ([fcd49ad](https://github.com/ariefsaid/PMO/commit/fcd49adbda8fcdab16022ce71f09d0f36dcb1083))
* **subcontracts:** an organisation with no ERP can void a mistyped bill ([#1671](https://github.com/ariefsaid/PMO/issues/1671)) ([a154eed](https://github.com/ariefsaid/PMO/commit/a154eedde5cd42c2e2a615ca088ede51829d18c1))
* **sync:** the background sync run keeps every outside call inside one time budget ([#2149](https://github.com/ariefsaid/PMO/issues/2149) part A) ([2a85e1b](https://github.com/ariefsaid/PMO/commit/2a85e1b2e3315e54323f57a46826e26735aa75a6))
* **ui:** a money figure never wraps or breaks in 12 more places ([#2346](https://github.com/ariefsaid/PMO/issues/2346)) ([31a4ea7](https://github.com/ariefsaid/PMO/commit/31a4ea7da1768e582c0e839d6e3a378807bafe7d))
* **ui:** a money figure never wraps or breaks in twelve more places ([#2346](https://github.com/ariefsaid/PMO/issues/2346)) ([cbb51ef](https://github.com/ariefsaid/PMO/commit/cbb51ef334779237a24598dade9e2c6f7aae364c))


### Performance

* **#2197:** hold the space of late reads - Won/Lost columns and phone tail, receivables chip row, invoice record action slot ([3cb8046](https://github.com/ariefsaid/PMO/commit/3cb8046e318c0116e922a846b3d1e7bec66eb0dd))
* **#2197:** invoice record shows once loaded, revenue mode holds only the action; pipeline lost-state test follows the per-region contract ([ba1a113](https://github.com/ariefsaid/PMO/commit/ba1a113ea7b814f2163d384c5c1643f627353b7d))
* **2197:** drop A14/A15 leftovers (test ids, mock fields) ([15cca61](https://github.com/ariefsaid/PMO/commit/15cca6162f8cbef2429c9d1e1dc008995c01eb95))
* **2197:** region hooks for the A11-A17 routes ([3bd6eab](https://github.com/ariefsaid/PMO/commit/3bd6eab8b1b5259e14a8a2c57d69f7c009c2b299))
* **nbr:** region test ids for the project detail slices and their after-timings (A5-A8, [#2197](https://github.com/ariefsaid/PMO/issues/2197)) ([fa241c3](https://github.com/ariefsaid/PMO/commit/fa241c37eaf899caada05391a15a53db142415c2))


### Refactors

* **#2197:** drop the unused revenue-mode prop from the invoice record ([c244005](https://github.com/ariefsaid/PMO/commit/c244005581223971783da40235a8b91f2b14b49d))
* **procurement:** one reading for Left and Budget used; strip columns follow tile count; helper test names say left and open orders ([5d98fc6](https://github.com/ariefsaid/PMO/commit/5d98fc682ab9db40e022ef0f7146b4f9a5c6ccd9))

## [0.40.0](https://github.com/ariefsaid/PMO/compare/v0.39.0...v0.40.0) (2026-11-14)


### Features

* **procurement:** record purchases that already exist in the ERP (slice A) ([6b3bfa0](https://github.com/ariefsaid/PMO/commit/6b3bfa061763c6900b100ffdafd6fd36a6a46e51))


### Bug Fixes

* **agent:** usage metering failure state is kept per organization ([fdbb792](https://github.com/ariefsaid/PMO/commit/fdbb79284d729e6a641a194169d3ef6d54834bb3))
* **auth:** login footer is a page landmark again ([c9433d5](https://github.com/ariefsaid/PMO/commit/c9433d5aef3828be92bedb882df51b35c281c563))
* **auth:** login footer is a page landmark again ([091a28f](https://github.com/ariefsaid/PMO/commit/091a28fecdc52a447bc17d6596c4531b5c3e8e54))
* **auth:** preserve mobile footer link targets ([a2e4375](https://github.com/ariefsaid/PMO/commit/a2e43759a1c1cacaa67c6ed780aa809b949cdcad))
* **auth:** profile load-error page gets fixed recovery copy and a real Retry ([398b830](https://github.com/ariefsaid/PMO/commit/398b830b49d933f558e582a5ee1b24876489b996))
* **auth:** profile-load error page gets fixed recovery wording, Retry and Sign out ([385aa11](https://github.com/ariefsaid/PMO/commit/385aa11766a1608bca6ffee148e4acff20ec9811))
* **auth:** serialize profile retry and preserve error kind ([198df7d](https://github.com/ariefsaid/PMO/commit/198df7dabe544f62e13dc3f71f469445cd56456c))
* **auth:** sign-in screens share one header, meet the type floor and name their landmarks ([09f852a](https://github.com/ariefsaid/PMO/commit/09f852a7d5eaa2ef7c603038873df9e46c1eb51a))
* **budget:** keep overview concise and basis visible ([57f0c35](https://github.com/ariefsaid/PMO/commit/57f0c35e2f155613341a2800466e4d13e4d4df81))
* **budget:** reconcile review findings ([f7b6ece](https://github.com/ariefsaid/PMO/commit/f7b6eceee3033b3637e24ab302e74b887ce2e9b1))
* **budget:** remove compact toggle inset ([5ac18b9](https://github.com/ariefsaid/PMO/commit/5ac18b94ce31d7d88ef0961ab8ad0a4ec6049a14))
* **budget:** restore concise category status ([7816494](https://github.com/ariefsaid/PMO/commit/7816494ebfad0ffbcde00feb6f2f93a75f63633c))
* **budget:** restore overview spending verdict ([efedabf](https://github.com/ariefsaid/PMO/commit/efedabf7c6407b1ca1cfd5d6cc6756a8a2192077))
* **budget:** use shared compact button sizing ([5d115ef](https://github.com/ariefsaid/PMO/commit/5d115ef1294bcb868270a59e4ca01bbb56415923))
* **calendar:** B7 one line above the grid replaces the notice and the scope line ([9fcbbea](https://github.com/ariefsaid/PMO/commit/9fcbbeaf371f73ffa2eb4f11a26f30a590fdcb27))
* **calendar:** B7 the My Tasks link gets a 44px tap area without growing the line ([f542118](https://github.com/ariefsaid/PMO/commit/f5421181b65154cb9dac33736adbbb098c54ae09))
* **calendar:** B7 the today ring stands 2px clear of the digits ([d89dc9a](https://github.com/ariefsaid/PMO/commit/d89dc9a90043a63cba63c612d55d9a9e557e497d))
* **calendar:** call a milestone a phase, the name this screen already uses ([560f5bd](https://github.com/ariefsaid/PMO/commit/560f5bd3ed090b4a9347acd1d8c34ea8072eb54b))
* **calendar:** move 1 an empty month says so, with the way to the task list ([c0fd6b8](https://github.com/ariefsaid/PMO/commit/c0fd6b88f278acfa610916e306492b3aa8cc026f))
* **calendar:** move 2 the scope line names meetings as not on this calendar ([61472b4](https://github.com/ariefsaid/PMO/commit/61472b4032028d4bd85314c935f285eefd389760))
* **calendar:** move 3 day number top-left, today a ring around it ([f805f9e](https://github.com/ariefsaid/PMO/commit/f805f9ea2bf8df53f1c59dcde93781756b47887a))
* complete lane C final display repairs ([21821ca](https://github.com/ariefsaid/PMO/commit/21821ca2fe5f8b93988cd391c0a3cdbda00ce551))
* **contact-record:** B4 restore visible Edit and phone facts ([c58efd8](https://github.com/ariefsaid/PMO/commit/c58efd8d723cfb40135958a17a126a5e0cbfd629))
* **contact-record:** expose company field label ([b0f41a0](https://github.com/ariefsaid/PMO/commit/b0f41a00162e8873523eddd43a2dccb0383c5cac))
* **contact-record:** expose date field label ([44d787c](https://github.com/ariefsaid/PMO/commit/44d787c3a91c91f4302547a570eacc4148d126e9))
* **contact-record:** L1 preserve current instant for today ([f907e80](https://github.com/ariefsaid/PMO/commit/f907e80659611723007d908e130cdd3455c7aaf2))
* **contact-record:** move 1 header action ([6d7af8b](https://github.com/ariefsaid/PMO/commit/6d7af8b7d6d5789f87c064ccfc4c11aee5064c18))
* **contact-record:** move 2 facts to header ([03df73f](https://github.com/ariefsaid/PMO/commit/03df73f1b938a711e5facb34b4fa3e8e57b132ff))
* **contact-record:** move 3 date log form ([734c6ec](https://github.com/ariefsaid/PMO/commit/734c6ec6874ec54c61bf85e64355009ce2767d01))
* **contact-record:** move 4 show archived state ([6bd327b](https://github.com/ariefsaid/PMO/commit/6bd327bf22afabb8897251ea0e65fceab3859609))
* **contacts:** align filters and restore link styling ([dfac2aa](https://github.com/ariefsaid/PMO/commit/dfac2aa5109dd67bbdbc82365d918bba2c09fffd))
* **contacts:** keep card titles secondary ([ba2be27](https://github.com/ariefsaid/PMO/commit/ba2be27d951a5a45523e4998d03da510dd6714f4))
* **contacts:** move 1 shared toolbar ([0d3f4ae](https://github.com/ariefsaid/PMO/commit/0d3f4aee6a83b2c37ff5972e5f6b7d962218c46b))
* **contacts:** move 2 single count ([85542a3](https://github.com/ariefsaid/PMO/commit/85542a334ba0ea9671dd305869ff97f74c9e8e4e))
* **contacts:** move 3 show title and phone ([d25b74f](https://github.com/ariefsaid/PMO/commit/d25b74fd47eb76ad39a2eccd198130b59e5514c5))
* **contacts:** move 4 remove restore promise ([1ae7e91](https://github.com/ariefsaid/PMO/commit/1ae7e913a5e9240991dfda87ec2c9cdd1aa08029))
* **contacts:** restore archive recovery wording ([937b40a](https://github.com/ariefsaid/PMO/commit/937b40adbfada00f05490b4eaf47c93edca1a281))
* **contacts:** restore clear all link color ([05327dd](https://github.com/ariefsaid/PMO/commit/05327ddfddf2838627cf36910a8b00d9c34941c3))
* **contacts:** restore whole directory count ([eb594f3](https://github.com/ariefsaid/PMO/commit/eb594f33c17a36bc13a9e976d662889c5b2ef4ca))
* **contacts:** wrap phone email values below labels ([b89ba27](https://github.com/ariefsaid/PMO/commit/b89ba27bb4928bc7f15ba562fae66638758831d1))
* **controls:** align budget and dashboard heights ([4cf1375](https://github.com/ariefsaid/PMO/commit/4cf1375f13176166d2fd2569655b5519fa6d5e7c))
* **dashboard:** use compact period controls in home headers ([6482d60](https://github.com/ariefsaid/PMO/commit/6482d604c7063508b481d07460bab633416afb0b))
* drawer Open full page carries the list's return context ([5664260](https://github.com/ariefsaid/PMO/commit/5664260e30525e84889c82363ed5a2473adac2a9))
* **equipment-assets:** move 2 the empty register offers a quiet New asset ([c90943c](https://github.com/ariefsaid/PMO/commit/c90943c5e482a0d38f8525f1065915d93b27a1bf))
* **expenses-new:** keep project category wrapper layout only ([2d9d5f5](https://github.com/ariefsaid/PMO/commit/2d9d5f5b494350a9a72189abbd3ac4ba9f6f3966))
* **expenses-new:** move 1 narrow claim form ([d5b6ffa](https://github.com/ariefsaid/PMO/commit/d5b6ffa45ef1fad9c883fb7008555c53df318257))
* **expenses-new:** move 2 grid expense lines ([6f2fd6e](https://github.com/ariefsaid/PMO/commit/6f2fd6e4e4250f5726a77091b228b6bb83162893))
* **expenses-new:** move 2 keep description in grid ([8f7adb1](https://github.com/ariefsaid/PMO/commit/8f7adb18f46be4fa335b5f296179c677fe29483f))
* **expenses-new:** move 3 prefix amount currency ([912bcab](https://github.com/ariefsaid/PMO/commit/912bcabc7e5e5e88c4429f7cd6e7e828983e5697))
* **expenses-new:** move 5 clarify category and save action ([c3fce1a](https://github.com/ariefsaid/PMO/commit/c3fce1a569413a066a4cb88c9cfe4c035c8f28a6))
* **expenses-new:** share category help and align heading ([1a77bec](https://github.com/ariefsaid/PMO/commit/1a77becb4bfc39dc4ec6a49c32f2e302b36038d3))
* **expenses:** move 1 the empty-state New claim is the quiet outline ([3f3a09a](https://github.com/ariefsaid/PMO/commit/3f3a09a1790a59e35cb9b9b029b991f3f50389d6))
* **expenses:** report receipt signing errors promptly ([8f646ee](https://github.com/ariefsaid/PMO/commit/8f646eebadd166da3eb8cd25fa30c3d4c13c23ed))
* explain unavailable budget position inputs ([4da90ae](https://github.com/ariefsaid/PMO/commit/4da90aee26537de29f64834d9ea84dc3bbc6317f))
* faster expense receipt save; task board columns keep their width ([b7b99b3](https://github.com/ariefsaid/PMO/commit/b7b99b3c18a3a751272ecbf1ebface678b3bd310))
* **i18n:** the Microsoft 365 card action reads Retry (F8) ([08e5f8a](https://github.com/ariefsaid/PMO/commit/08e5f8afd9439ccf3bb8cbc05dfa6a690517b431))
* **imprest:** outline the empty state establish float ([31bc824](https://github.com/ariefsaid/PMO/commit/31bc824223399074071aa5b3f7edd942344dab46))
* **incoming-payment-record:** align missing-figure test text ([916f33a](https://github.com/ariefsaid/PMO/commit/916f33a12ff132d5ea52d544337c58c5d8aeeead))
* **incoming-payment-record:** C3 incoming payment names ([a51740b](https://github.com/ariefsaid/PMO/commit/a51740bf397a8e9a72fe3d368c4f2603bf2ff111))
* **incoming-payment-record:** move 1 payment received name ([fbfbe5e](https://github.com/ariefsaid/PMO/commit/fbfbe5ecdc99f25d7489c213af003921aa9adc1a))
* **incoming-payment-record:** move 2 shared receipt header ([1b381ea](https://github.com/ariefsaid/PMO/commit/1b381ead0f4f17c75a7dc064671e899a4c8d4f62))
* **incoming-payment-record:** move 3 name missing figures ([ee26a10](https://github.com/ariefsaid/PMO/commit/ee26a1001110fef931919aedcd210a99a8874638))
* **incoming-payment-record:** move 4 client invoice link ([6b085cb](https://github.com/ariefsaid/PMO/commit/6b085cb193614da2a9d130ce9450c870dc44d9d6))
* **incoming-payment-record:** move P5 labelled missing facts ([b5fdd53](https://github.com/ariefsaid/PMO/commit/b5fdd539b554b3862790b43f1c9d4d3a63e8d611))
* **incoming-payment-record:** move P6 finance breadcrumb ([7179663](https://github.com/ariefsaid/PMO/commit/7179663e9b4f49f25eed7e3eab67846b5b418c8f))
* **invite:** an invite never removes an account; existing addresses are refused before issuance ([#2252](https://github.com/ariefsaid/PMO/issues/2252)) ([4f1b7c8](https://github.com/ariefsaid/PMO/commit/4f1b7c86362b084c2488dade9f6d1b3dafee78d3))
* **invite:** validate literal addresses ([#2252](https://github.com/ariefsaid/PMO/issues/2252)) ([c72a929](https://github.com/ariefsaid/PMO/commit/c72a92933eb15ec63a0b14771a5e9424fb07dd23))
* **meetings:** keep combobox copy sentence case ([cc215a1](https://github.com/ariefsaid/PMO/commit/cc215a19c8afb175844bf8119663f4b8ab6f725b))
* **meetings:** L2 hide count until read settles ([055f802](https://github.com/ariefsaid/PMO/commit/055f80263f5a738995467884085b092bf155a702))
* **meetings:** move 1 keep filters in one toolbar row ([d209faa](https://github.com/ariefsaid/PMO/commit/d209faa09c1d1ccf7ac20710f4885a743a15d06c))
* **meetings:** move B2 toolbar labels and count ([fa15270](https://github.com/ariefsaid/PMO/commit/fa152709ae52886746791ac788c601ce4b6bacdc))
* **meetings:** move B2 toolbar wrap and count ([b206502](https://github.com/ariefsaid/PMO/commit/b206502b60bb2dc9bc85681afde99b88937d9671))
* **meetings:** read the loaded-more count from the projects catalogue ([beb1bb5](https://github.com/ariefsaid/PMO/commit/beb1bb51584e9060a586dcfd3e4b9beaa9789fd1))
* **meetings:** use combobox in zero-match proof ([f741ddb](https://github.com/ariefsaid/PMO/commit/f741ddbe57f4c3ad0ec140b45f749aaa1568d53d))
* **meetings:** use translated clear filter key ([aa95aa5](https://github.com/ariefsaid/PMO/commit/aa95aa5458a9499d891f30cd4c74c9d69ddd783c))
* **money:** budget used is one figure on every project screen ([4c9b1e4](https://github.com/ariefsaid/PMO/commit/4c9b1e452f88ae761d2c85019b70b45e07724ae5))
* **my-tasks:** B6 row words return beside their icons ([45159ff](https://github.com/ariefsaid/PMO/commit/45159ff6b919e6f66ffc1ff55348f26f7d494121))
* **my-tasks:** move 1 the counts say open and overdue in words ([5a07787](https://github.com/ariefsaid/PMO/commit/5a077876124d9bd8b5149c27591c47ff33302375))
* **my-tasks:** move 2 group order compares the rank key plainly ([e20e7fa](https://github.com/ariefsaid/PMO/commit/e20e7fae2bd50e779c2591b7183f1beeef03db45))
* **my-tasks:** move 2 the worst project leads the queue ([118a4a7](https://github.com/ariefsaid/PMO/commit/118a4a79135a5400c9aa08071f5c7fc1579af715))
* **my-tasks:** move 3 row actions are quiet icons ([abc5c94](https://github.com/ariefsaid/PMO/commit/abc5c9488e7ce8ad83baf25e4f76a76da41335b1))
* **my-tasks:** move 3 row actions keep the 44px phone target ([834c132](https://github.com/ariefsaid/PMO/commit/834c132e998aaf6a51287633d39211c5bc75f1dc))
* **my-tasks:** move 4 the heading is My Tasks ([60c5428](https://github.com/ariefsaid/PMO/commit/60c5428e5b0826675bf882e913d76e4162641e1d))
* **payables:** items 1-3 the age bar tiles its legend column exactly ([66178c1](https://github.com/ariefsaid/PMO/commit/66178c1106cf8cc3744ab8ba0350dfe1693f9611))
* procurement record hidden figures explain themselves through Why ([521a5d8](https://github.com/ariefsaid/PMO/commit/521a5d8aa9ab8055be2b09c82192b7bb0cbdf75e))
* procurement stage chips write the stage to the URL like the list's other filters ([6d24c55](https://github.com/ariefsaid/PMO/commit/6d24c5542406ab429ab7a61c3842cfbc5c5413d5))
* **procurement-new:** align guarded back journey ([5304e71](https://github.com/ariefsaid/PMO/commit/5304e71a3462de2e195285c6541663542a00a9a3))
* **procurement-new:** C1 guard unadded line input ([e7119d9](https://github.com/ariefsaid/PMO/commit/e7119d9bb4f4b13f65fd9163f1a4acd1f2f63a67))
* **procurement-new:** C4 disclose budget approval rule ([863ae7c](https://github.com/ariefsaid/PMO/commit/863ae7c583bf453d25b4f7bd91930a10f7d51cbf))
* **procurement-new:** C5 guard Change type navigation ([6d5c6ab](https://github.com/ariefsaid/PMO/commit/6d5c6ab191579fc72290d139d5ef5621cfec6a4a))
* **procurement-new:** discard empties the whole draft ([5b9128c](https://github.com/ariefsaid/PMO/commit/5b9128c0eaa7893b303e9fa08effa99b5df5885e))
* **procurement-new:** move 1 editable line row in grid ([58d24a7](https://github.com/ariefsaid/PMO/commit/58d24a7933f35cf79f731c574185e27930071c19))
* **procurement-new:** move 2 unknown money stays blank ([8c2a512](https://github.com/ariefsaid/PMO/commit/8c2a5121b9c65949a46250989b1af76b0daaef2f))
* **procurement-new:** move 3 trim approval and row copy ([1360597](https://github.com/ariefsaid/PMO/commit/136059794210bb1c8e108051f4cc9fa37bc2ddac))
* **procurement-new:** move 4 align create form shell and exits ([0e48a63](https://github.com/ariefsaid/PMO/commit/0e48a6328c519fa71e419b751dedac5be5252932))
* **procurement-new:** move 5 keep phone row labels and total ([c2a5626](https://github.com/ariefsaid/PMO/commit/c2a56264cf69983b2ba691d542a0ca39979cc27c))
* **procurement-new:** move 5 set phone proof width ([3cfd50c](https://github.com/ariefsaid/PMO/commit/3cfd50cac2d8ea5b81540df69160e24e94329436))
* **procurement-new:** position budget help on phone ([16a7f5d](https://github.com/ariefsaid/PMO/commit/16a7f5ddda783a9d5d40471e075f8c70305f5548))
* **procurement-new:** preserve cents in draft total ([1dea414](https://github.com/ariefsaid/PMO/commit/1dea414efe4cbb220a0ee3523831d341fa92f308))
* **procurement-new:** reflow line entry on phones ([522cd74](https://github.com/ariefsaid/PMO/commit/522cd7457a98bff57d9d07c9c6a93666897d67e4))
* **procurement-new:** reset add-row guard after adding ([d782c95](https://github.com/ariefsaid/PMO/commit/d782c95d690345815950a1234281637f1c30a793))
* **procurement-new:** scope line widths to create form ([7133459](https://github.com/ariefsaid/PMO/commit/7133459cea635db06fa0bc3b690ae5f03b0d3317))
* **procurement-new:** share budget category help ([ff435ef](https://github.com/ariefsaid/PMO/commit/ff435ef83c3c06dc15469e5462da01fc718d20f1))
* **procurement-new:** space and fit line item card ([1f95e65](https://github.com/ariefsaid/PMO/commit/1f95e65d82b96b0943e595457b5e7857189b3195))
* **procurement-new:** type the create add row id ([46ea241](https://github.com/ariefsaid/PMO/commit/46ea241901b8817f87b352a1bddf254fe892a45b))
* restore whole-unit procurement display ([5dc9bcb](https://github.com/ariefsaid/PMO/commit/5dc9bcbe94f2eb07c86b729c5ee9e1286bd20da8))
* **sales-invoice-record:** C2 always show tax and total due ([5e8a2a2](https://github.com/ariefsaid/PMO/commit/5e8a2a2f436f08acfcff203d002863d1ab75e0e1))
* **sales-invoice-record:** hide unverified tax totals ([0c791a9](https://github.com/ariefsaid/PMO/commit/0c791a9c58c2e1e052186b8d038425cb9dfa507e))
* **sales-invoice-record:** keep number and timeline visible ([bf81b4e](https://github.com/ariefsaid/PMO/commit/bf81b4ec8e531613c74344a9e10da2ffa3746bfa))
* **sales-invoice-record:** move project and date facts to header ([eafa702](https://github.com/ariefsaid/PMO/commit/eafa702fa4ae3f58750295285c224725b880e3a0))
* **sales-invoice-record:** use finance invoice breadcrumb ([30db005](https://github.com/ariefsaid/PMO/commit/30db005444187bd252e9a8a92de47d55e664fe32))
* **sales-invoice-record:** use one lifecycle track ([d77062d](https://github.com/ariefsaid/PMO/commit/d77062d026e54bdd1cbad0ac249c800fb3496554))
* **sales:** align board basis labels with open deals ([580b67f](https://github.com/ariefsaid/PMO/commit/580b67fdec3e1ff982f468aa0a25282997e6bab1))
* **sales:** clarify pipeline movement messages ([9bae401](https://github.com/ariefsaid/PMO/commit/9bae401f96fe7639e71737ea56078e18615e504a))
* **sales:** move 3 fit board columns ([c07bbc2](https://github.com/ariefsaid/PMO/commit/c07bbc2f03d99c7956f4a27ea71f29b77d30cc65))
* **sales:** move 5 remove empty toolbar band ([0ab92e0](https://github.com/ariefsaid/PMO/commit/0ab92e0e4e9aa9133a62292bf4754b4dc6f46440))
* **sales:** remove unused ListPage search-first path ([5a48f09](https://github.com/ariefsaid/PMO/commit/5a48f09f6616b8827dd70d203e3e4da2b76ec943))
* **sales:** restore board column widths ([ea3eae2](https://github.com/ariefsaid/PMO/commit/ea3eae22937359a11f975f114e6b92312dad20b2))
* **sales:** truncate single-token board ids ([336c6dd](https://github.com/ariefsaid/PMO/commit/336c6dda1300ecbc18f0c2d5b41eb1105594e2a5))
* show spending and open order budget position ([4d5e5cf](https://github.com/ariefsaid/PMO/commit/4d5e5cf79eeb5e0a95e14a66746b129444b18015))
* **splitbar:** move 1 the invoice-age bar becomes the shared split bar ([3273fbe](https://github.com/ariefsaid/PMO/commit/3273fbeb23dc7e03df6cf01254a134e3aa0c9c67))
* **splitbar:** move 2 the home owed bars use the shared bar ([dcfc16d](https://github.com/ariefsaid/PMO/commit/dcfc16d71b4da47e057dc25e2d245d2430ee7c1f))
* **stock-documents:** move 2 new document menu ([c2c6b42](https://github.com/ariefsaid/PMO/commit/c2c6b4294ed074a0ea89a48d9866a51aecf68992))
* **stock-documents:** move 3 warehouse names ([e4dc8b2](https://github.com/ariefsaid/PMO/commit/e4dc8b22feebe7d250bd60a0e3c657f8b76c3f4b))
* **stock-documents:** move P13 phone warehouse and menu rows ([dadb90a](https://github.com/ariefsaid/PMO/commit/dadb90ad4163d9962164683e700e95d7bd406e14))
* **stock-ledger:** align Change and keep unit beside figure ([089b8c0](https://github.com/ariefsaid/PMO/commit/089b8c06007e3d0340a06fb95cd758bf4bbd3a22))
* **stock-ledger:** fit ledger columns at 1280 ([c8345ad](https://github.com/ariefsaid/PMO/commit/c8345ad37cef6a433520b4763cb9c629dbad55ed))
* **stock-ledger:** move 9 preserve long codes ([a8c81a8](https://github.com/ariefsaid/PMO/commit/a8c81a863c87133c962f052f442b536b2161f238))
* **stock-ledger:** preserve export header labels ([7aab362](https://github.com/ariefsaid/PMO/commit/7aab362d586f11c6d71fd43210dc7f9377195a21))
* **stock-on-hand:** move 2 separate value figure ([d815ec5](https://github.com/ariefsaid/PMO/commit/d815ec5e0215444e72b2bc17f31cabc216ea0c53))
* **stock-on-hand:** move 3 put item name first ([6dc151f](https://github.com/ariefsaid/PMO/commit/6dc151fd8f1c03218580e01079de4a117e618004))
* **stock-on-hand:** move 4 activate balance rows ([62cc64b](https://github.com/ariefsaid/PMO/commit/62cc64bc4120082ad12792568da8f8257bd4d621))
* **stock-on-hand:** restore compact code-first identities ([5b1ea01](https://github.com/ariefsaid/PMO/commit/5b1ea0121c0fc5a99ae0509f64496cd65f014aff))
* **stock-setup:** move 1 use stock child crumb ([bf496a1](https://github.com/ariefsaid/PMO/commit/bf496a1a6cfd4b1766534f3d46b2916c51669479))
* **stock-setup:** move archived filter below phone tabs ([8fa16dc](https://github.com/ariefsaid/PMO/commit/8fa16dce00f3e9c5d7430ef71e4293f55ddeb984))
* **stock-setup:** restore stock route navigation ([936ba7d](https://github.com/ariefsaid/PMO/commit/936ba7d303e420ba86a3eac23377f74d51b08def))
* **stock-setup:** scroll current stock tab into view ([bc5588b](https://github.com/ariefsaid/PMO/commit/bc5588b4041de3852fc734770be397f404707a41))
* **stock:** drop the unused navigate dependency from the on-hand columns ([2f7401a](https://github.com/ariefsaid/PMO/commit/2f7401abb44374261ecd678249dd855af25699dc))
* **stock:** move 1 request purchase from a short row ([7ca6c0a](https://github.com/ariefsaid/PMO/commit/7ca6c0ae96182d0cf4721f1f746bd7d266c4cbee))
* **stock:** move 3 name the order figure suggested order ([75b06a6](https://github.com/ariefsaid/PMO/commit/75b06a65528c4f634eb7b381cedbcfa7e9dc88eb))
* **stock:** P11 order quantity label back, both languages ([ae75e8a](https://github.com/ariefsaid/PMO/commit/ae75e8a9776ab3725ee30368e3197d79f69f6636))
* **test:** scope work-order filter row assertions ([ddde743](https://github.com/ariefsaid/PMO/commit/ddde743cef8481b1f3701b14597893b823963516))
* **ui:** contacts, meetings, calendar, my tasks and sales board repairs (six screens) ([23a27f1](https://github.com/ariefsaid/PMO/commit/23a27f15dd2beba24dc4ba53950b4b1b395d0e57))
* **ui:** F12 the stock on hand phone card keeps the labelled average cost ([566d446](https://github.com/ariefsaid/PMO/commit/566d446568b8f1b71651ada37329a7234bca9b17))
* **ui:** F3b the M365 Retry button sits centred on its sentence line ([64e0195](https://github.com/ariefsaid/PMO/commit/64e0195e96c0beb2d6b38906f94b67f50a525d9c))
* **ui:** F7 align shared control heights ([79c985d](https://github.com/ariefsaid/PMO/commit/79c985d80dfb024d423acb76261315edca03215e))
* **ui:** F9b stock ledger keeps one date column, breaks codes only at hyphens, and fits its box at 1440 ([4b1d19b](https://github.com/ariefsaid/PMO/commit/4b1d19b1fc45be67a7734c33ebfce048e7cd7035))
* **ui:** F9c By moves under Document below 1536 in the stock ledger ([39c1e6e](https://github.com/ariefsaid/PMO/commit/39c1e6ec5d53122f525b3a803ca6bd6a7f05f927))
* **ui:** F9d ledger secondary lines wrap instead of forcing column width ([cb24a42](https://github.com/ariefsaid/PMO/commit/cb24a424bcac1cd5d73536bb59e6d67870d99c2e))
* **ui:** keep combobox trigger labels on one line ([6326582](https://github.com/ariefsaid/PMO/commit/6326582089ce4a6af569aafc59f5848bbf3cefe8))
* **ui:** retry supplier read from company home ([3e324a9](https://github.com/ariefsaid/PMO/commit/3e324a9cd459fc34cb6fbd92bab107f77721bffc))
* **ui:** stock and finance-record screen repairs (ten screens) ([def701c](https://github.com/ariefsaid/PMO/commit/def701cc2c9e83f991a325d56f9be78067b60349))


### Performance

* **expenses:** overlap receipt recovery and signing ([7b5f6bb](https://github.com/ariefsaid/PMO/commit/7b5f6bb46bbda263da7e3e5d78408beedf7ca28a))


### Refactors

* **sales:** board tax-basis context in its own module ([54cfdb7](https://github.com/ariefsaid/PMO/commit/54cfdb7eefcebbbe829944dc0856091e2c89ffce))

## [0.39.0](https://github.com/ariefsaid/PMO/compare/v0.38.0...v0.39.0) (2026-11-13)


### Features

* **finance:** one budget-position read for every project ([25cec6f](https://github.com/ariefsaid/PMO/commit/25cec6f5979d473a94cafdd34c02bf3579af33ec))


### Bug Fixes

* **c8b:** page every asset read and stop printing totals a list cannot reach ([aa57691](https://github.com/ariefsaid/PMO/commit/aa57691cca8ed7cdf2063b561d548eff7ae62cb6))
* **c8:** show truthful counts for paged lists ([92f3323](https://github.com/ariefsaid/PMO/commit/92f332312ecedc0fd70659eca72c4fb234eb94f3))
* **contract:** billing tools keep what you typed when the contract data finishes loading ([ccc236d](https://github.com/ariefsaid/PMO/commit/ccc236dbf915c29a7cf26f2b183ce252725baf8d))
* **finance:** invoiced figures agree across the contract tab, Reports, the home and the export ([8746847](https://github.com/ariefsaid/PMO/commit/874684783a322ea0dcb39d40a4604a0cb6f96687))
* preserve contract tool subtree while loading ([7b0e430](https://github.com/ariefsaid/PMO/commit/7b0e430b887afad818e7ca8e5bd3c3fd0783db37))
* **profile:** explain a disabled Save and restore the saved wording ([d365163](https://github.com/ariefsaid/PMO/commit/d365163c335f362b2c3ee14a46d4c5d503a82473))
* **profile:** keep the no-changes line in the profile preferences catalogue ([8854ad9](https://github.com/ariefsaid/PMO/commit/8854ad9bf386b50447203b5610e4bac690fe565f))
* repair stale state after C10 actions ([1c9ed6a](https://github.com/ariefsaid/PMO/commit/1c9ed6ab4ddf103ea6bd0f9cd24ae556f1e0f9e1))
* reuse saved timesheet id before refetch ([9f1b2e7](https://github.com/ariefsaid/PMO/commit/9f1b2e7ab1259f2d66109f6f5d58ad4792436f9d))
* **stock:** bring a refused post into view at 390 ([9e00c7b](https://github.com/ariefsaid/PMO/commit/9e00c7b2adf3c3178d98811c6fea528a6a1c000b))
* **stock:** name the reorder columns in the level-in-force line ([fa54b6e](https://github.com/ariefsaid/PMO/commit/fa54b6ec137f99041479f0773d65ead87aa8ff24))
* **timesheets:** Save then Submit on a new week no longer fails with a duplicate ([97f6dbb](https://github.com/ariefsaid/PMO/commit/97f6dbbccc2f958b366ab3c581ae588bd7764d6b))
* **ui:** lists you can scan, stated meanings, Profile save state (all-screens batch 1) ([1499075](https://github.com/ariefsaid/PMO/commit/149907508f456cb70a6069a740671df35af6e9d2))
* **ui:** say what nine controls mean where the copy was silent ([d5e6ac9](https://github.com/ariefsaid/PMO/commit/d5e6ac910b08baae182a9f024af73382c05e0c10))
* **ui:** use default tone for reversible changes ([43b0377](https://github.com/ariefsaid/PMO/commit/43b0377ec94ef2540348bf5b1bfc59d45f674921))

## [0.38.0](https://github.com/ariefsaid/PMO/compare/v0.37.0...v0.38.0) (2026-11-12)


### Features

* **procurement:** record a purchase from existing ERP journal cost lines ([#2195](https://github.com/ariefsaid/PMO/issues/2195)) ([03f7c47](https://github.com/ariefsaid/PMO/commit/03f7c47e85563ff59eae7e8cc74de55358dcaf82))


### Chores

* release 0.38.0 ([d2c2237](https://github.com/ariefsaid/PMO/commit/d2c223789e4a28daf29da9fc1d57672ab0eab7e3))

## [0.37.0](https://github.com/ariefsaid/PMO/compare/v0.36.0...v0.37.0) (2026-11-12)


### Features

* **approvals:** a reason is required to return or reject, shown on the returned record ([#2185](https://github.com/ariefsaid/PMO/issues/2185)) ([8041b2d](https://github.com/ariefsaid/PMO/commit/8041b2daeef0b024c89d687e92c927c2a74c6089))
* **approvals:** align Approve and Return buttons side by side and unify confirmation ([ffdc491](https://github.com/ariefsaid/PMO/commit/ffdc49124186a39fa2361c7e402292688f1eaadc))
* **approvals:** store who rejected, when and why on timesheets, expenses, cash-float top-ups and equipment usage ([50428b7](https://github.com/ariefsaid/PMO/commit/50428b7c036ff6caa4a28e6254a9fab07cdffe64))
* build role-stable navigation shell ([cd2c227](https://github.com/ariefsaid/PMO/commit/cd2c227079054e62150195f1351eb9619eb5a329))
* **ux:** company home answers project health and finances first ([951f637](https://github.com/ariefsaid/PMO/commit/951f637da7fd777194ddbc33d178bef5d9a9c579))
* **ux:** screen redesign across dashboards, projects, finance, procurement, approvals, CRM, workforce, admin and phone layouts ([#2189](https://github.com/ariefsaid/PMO/issues/2189)) ([8041b2d](https://github.com/ariefsaid/PMO/commit/8041b2daeef0b024c89d687e92c927c2a74c6089))
* **ux:** screen redesign from the ux/1110 integration branch ([352e387](https://github.com/ariefsaid/PMO/commit/352e387b735a29c3454c1cfc8afc4a588c18f60c))


### Bug Fixes

* align navigation approvals counts ([72b08e0](https://github.com/ariefsaid/PMO/commit/72b08e0d84c080d6ddd176752af8fd992590a43c))
* clarify finance and project display figures ([d0aaccd](https://github.com/ariefsaid/PMO/commit/d0aaccdf748a6b62df0062062d597505f4f12ef1))
* close shared menu items consistently ([6051bca](https://github.com/ariefsaid/PMO/commit/6051bca73cfaf69f47837f57e576017d5cf2ecda))
* complete navigation shell behavior ([0ea0745](https://github.com/ariefsaid/PMO/commit/0ea074593cea993955e1f8826147d4e32f8677ac))
* **dashboard:** split finance and home loading gates ([9a05e45](https://github.com/ariefsaid/PMO/commit/9a05e45fdee4be31b0c129e83f95f87ab99ed40e))
* **documents:** long file names fit the document picker on a phone ([#2198](https://github.com/ariefsaid/PMO/issues/2198)) ([333776f](https://github.com/ariefsaid/PMO/commit/333776f271ee979414124714570e015f01aabecd))
* **e2e:** follow the ux/1110 budget, claim and quantity vocabulary ([da1d299](https://github.com/ariefsaid/PMO/commit/da1d299d72c65de59f1cf7ea263707bf45ea4dbd))
* **e2e:** re-point Projects-area locators to the ux/1110 records and copy ([82126c6](https://github.com/ariefsaid/PMO/commit/82126c631ee6a2ac20df3c4e7a26d4e1321e9928))
* **e2e:** repair release browser journeys; add figure-agreement gate ([6aa25a1](https://github.com/ariefsaid/PMO/commit/6aa25a1aaa5ee468c0d09014b7101173bde62331))
* **e2e:** restore release journey oracles ([7462672](https://github.com/ariefsaid/PMO/commit/7462672976b5d461c6022025a3a80d22c9e856e9))
* **finance:** bucket unknown overdue receivables ([fbecf1c](https://github.com/ariefsaid/PMO/commit/fbecf1cc3fc2a97fa32bc24749c88c28b8ebcf70))
* **finance:** count unknown receivables by age ([391895b](https://github.com/ariefsaid/PMO/commit/391895bf9e7c31a8d7652a7c2123631cad8ba5ff))
* **finance:** keep unknown balance note out of waiting header ([ca4fcc2](https://github.com/ariefsaid/PMO/commit/ca4fcc2423e41f04ffe59c4171bcfca8b4568eda))
* **finance:** separate monthly revenue labels ([2b5bb2b](https://github.com/ariefsaid/PMO/commit/2b5bb2ba62bb767322baf473d96fc4c3119124c4))
* **finance:** separate receivables without due dates ([4cb6b14](https://github.com/ariefsaid/PMO/commit/4cb6b141e1ea48bc27f592e9f9202c896732ed2d))
* **finance:** shorten the unknown-balance reason and inset the receivables status pill ([8354b5b](https://github.com/ariefsaid/PMO/commit/8354b5b0496becff121082f03e73f8b107b06933))
* **finance:** split payables and receivables loading gates ([7a4d9f1](https://github.com/ariefsaid/PMO/commit/7a4d9f11c7b942f16f17f449cbf45002f7f4ee70))
* **finance:** the over-budget link on the project health card opens the Budget tab ([#2198](https://github.com/ariefsaid/PMO/issues/2198)) ([333776f](https://github.com/ariefsaid/PMO/commit/333776f271ee979414124714570e015f01aabecd))
* **home:** never show a pipeline figure that adds two currencies ([7556b96](https://github.com/ariefsaid/PMO/commit/7556b969c3fafc6fba30be56c19f4bb85ec38e8d))
* **home:** the finding line states overdue invoices without waiting on unrelated reads ([#2189](https://github.com/ariefsaid/PMO/issues/2189)) ([8041b2d](https://github.com/ariefsaid/PMO/commit/8041b2daeef0b024c89d687e92c927c2a74c6089))
* **home:** the finding line's finance clause waits only on its own invoices read ([e943406](https://github.com/ariefsaid/PMO/commit/e94340634e9b89fd9541c5dc1347b439f5a8c168))
* keep discard choices translated ([8b43eab](https://github.com/ariefsaid/PMO/commit/8b43eab3e41726025421262ef0a4c0dd6c500504))
* keep procurement and document errors visible ([fcf3bae](https://github.com/ariefsaid/PMO/commit/fcf3bae9e22c3184900c78f6ce1313fffeb42bb0))
* **m365:** keep the library row's full-width target beside its wrapping label ([27e04c7](https://github.com/ariefsaid/PMO/commit/27e04c70e11414b9b53f352d21aec2a69286975f))
* **m365:** the picker's long names wrap inside the dialog at 390px ([dbc7f64](https://github.com/ariefsaid/PMO/commit/dbc7f64eb756a5370c29a279726603faf54506e4))
* **navigation:** align place names across top bar, page title, and navigation ([5a27079](https://github.com/ariefsaid/PMO/commit/5a27079bc5b56c86261f6af80c96ab06ac02b1bc))
* preserve small budget amounts in read-only views ([6adbc26](https://github.com/ariefsaid/PMO/commit/6adbc265f7f9e0ae7c93cd9e591010d16b614c35))
* prevent mixed-currency pipeline displays ([733bc05](https://github.com/ariefsaid/PMO/commit/733bc05d35419438e657dc31af945e15146523bf))
* **procurement:** check ERP-linked documents before a receipt or invoice step ([a211d17](https://github.com/ariefsaid/PMO/commit/a211d175428dc9977e974ba7e6f9261915acd60e))
* **procurement:** check ERP-linked documents before a receipt or invoice step ([#2200](https://github.com/ariefsaid/PMO/issues/2200)) ([333776f](https://github.com/ariefsaid/PMO/commit/333776f271ee979414124714570e015f01aabecd))
* **procurement:** style refusal message ([3df45ae](https://github.com/ariefsaid/PMO/commit/3df45ae18d05f6a83cd004ca0f741de93da26037))
* restore sidebar navigation order ([01bb59e](https://github.com/ariefsaid/PMO/commit/01bb59e80c4f1c148d1651ec4433568ca5bc7925))
* reuse translated discard actions ([d91582b](https://github.com/ariefsaid/PMO/commit/d91582b4c449a1c9a7cdeb1cdbd24ae71cc77c56))
* seven red unit files on ux/1110 — two real regressions, five ruled changes ([ae17154](https://github.com/ariefsaid/PMO/commit/ae17154d88d496e88f7b67a8b281ceb055ebb771))
* **shell:** restore the sidebar order; guard not-found tests ([c6eddfe](https://github.com/ariefsaid/PMO/commit/c6eddfe6deeba65bdd18c074a3f665c3a23607d8))
* **shell:** restore the sidebar order; the command palette follows the same list ([#2206](https://github.com/ariefsaid/PMO/issues/2206)) ([333776f](https://github.com/ariefsaid/PMO/commit/333776f271ee979414124714570e015f01aabecd))
* **ui:** align numeric table columns ([9175ef6](https://github.com/ariefsaid/PMO/commit/9175ef6e7e420a4990aa3f07bfb7937471d928a0))
* **ui:** drop the translucent legend swatch on the stacked bar ([a187417](https://github.com/ariefsaid/PMO/commit/a1874179eb0b2379d44073469789552349b3052d))
* **ui:** make keep editing the unsaved default ([444d4ce](https://github.com/ariefsaid/PMO/commit/444d4ce8869e8ad5e054f540cbf4e940c0f60e33))
* **ui:** measured contrast pairs — loading label token, opaque stacked-bar ramp ([f64d547](https://github.com/ariefsaid/PMO/commit/f64d547d024595b93030b0eb4927ced48703a269))
* **ui:** use waiting tone for returned decisions ([1af0122](https://github.com/ariefsaid/PMO/commit/1af0122955be5c3b6341fed79e5a964ed23eb30e))
* **ux1110:** four red unit files — failed-confirm keeps dialog, distinct ledger retry, restored incidents search analytics, dual-layout core line ([e2c3f6c](https://github.com/ariefsaid/PMO/commit/e2c3f6cf93f24d89e7dff868c0f66f99aeb29cf4))
* **ux1110:** ten list screens keep their filters in the page address (R2) ([03ea3e5](https://github.com/ariefsaid/PMO/commit/03ea3e523cee4cfe70cc04bbba87f4c740480dfd))
* **ux1110:** timesheet awaiting count and open-task count withhold their figure until loaded (F18/F19) ([07003f5](https://github.com/ariefsaid/PMO/commit/07003f567f3124c7d47d48d4715e4bf5ff79e57c))
* **ux:** align sales and project overview rows ([d307752](https://github.com/ariefsaid/PMO/commit/d3077529f05a9776bbb59dcc2fc855c419927e42))
* **ux:** align screens with shared rules ([179830e](https://github.com/ariefsaid/PMO/commit/179830e4158c7d9edf309649f83fbbde9c58b70b))
* **ux:** balance project and sales overview rows ([bac8a66](https://github.com/ariefsaid/PMO/commit/bac8a6631d1ff453a19cc94183992c1f973e62af))
* **ux:** consolidate report missing figures ([07e51e9](https://github.com/ariefsaid/PMO/commit/07e51e9cf4b99641e58ad4a7c68793aa9f926af5))
* **ux:** keep budget caveat in scope line ([e27d3c7](https://github.com/ariefsaid/PMO/commit/e27d3c75830a6c2478dcedffe80a952e047d6fb6))
* **ux:** keep report caveats in shared Why list ([32d7b31](https://github.com/ariefsaid/PMO/commit/32d7b312e588f917e3f2c736726ee81ea16e5335))
* **ux:** one place for a form's primary action (R2-c2c) ([bca2e44](https://github.com/ariefsaid/PMO/commit/bca2e44cb4768fc52ead63891d72a72df79b6725))
* **ux:** report procurement comparison gaps in scope ([d590bed](https://github.com/ariefsaid/PMO/commit/d590bed398e50db1d598722c0f9dd2c7035f6014))
* **ux:** stack project overview milestones ([d20bf9a](https://github.com/ariefsaid/PMO/commit/d20bf9a9d2867e04ce9f36147cb8d1903962ffd0))

## [0.36.0](https://github.com/ariefsaid/PMO/compare/v0.35.0...v0.36.0) (2026-11-11)


### Features

* **equipment:** register and maintenance data layer ([#1511](https://github.com/ariefsaid/PMO/issues/1511) F5) ([8dcf3f4](https://github.com/ariefsaid/PMO/commit/8dcf3f467ed1be4aeaecd74a31b23b01eea629d1))


### Bug Fixes

* **erp:** restamp fingerprint tracks which PMO records still exist and which projects, not just counts ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([8dcf3f4](https://github.com/ariefsaid/PMO/commit/8dcf3f467ed1be4aeaecd74a31b23b01eea629d1))


### Performance

* **erp:** purchase attribution re-stamp runs only when its inputs changed ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([8dcf3f4](https://github.com/ariefsaid/PMO/commit/8dcf3f467ed1be4aeaecd74a31b23b01eea629d1))


### Chores

* release 0.36.0 ([a725762](https://github.com/ariefsaid/PMO/commit/a72576280f70a38dd10f7c84bed064921550ecfd))

## [0.35.0](https://github.com/ariefsaid/PMO/compare/v0.34.0...v0.35.0) (2026-11-10)


### Features

* **budget:** paste budget rows into a Draft, slice C dialog ([#1473](https://github.com/ariefsaid/PMO/issues/1473)) ([c9b5807](https://github.com/ariefsaid/PMO/commit/c9b58073fcfeec61179891fe225f29f74f4105f9))
* **budget:** return a submitted budget to the PM ([#1413](https://github.com/ariefsaid/PMO/issues/1413)) ([0e67f24](https://github.com/ariefsaid/PMO/commit/0e67f24ac3c02b1e93ab221b154bf7a9b2ecd87a))
* **budgets:** activate several imported drafts in one reviewed step ([#1273](https://github.com/ariefsaid/PMO/issues/1273)) ([ce3c461](https://github.com/ariefsaid/PMO/commit/ce3c461b67adc6f1846adf189be12ed17bba2189))
* **equipment:** match Odoo assets once and keep the register in Odoo ([#1511](https://github.com/ariefsaid/PMO/issues/1511) F3, migration 0854) ([93e0dc3](https://github.com/ariefsaid/PMO/commit/93e0dc33e502cb2ebeff4bdde9ec9870c65819aa))
* **erp-purchases:** attribute purchase orders to every project their item lines name ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([905fb57](https://github.com/ariefsaid/PMO/commit/905fb57645d08c006ae43845346860aefbfac0f7))
* **m365:** client self-serve setup slices 1-2 ([#1017](https://github.com/ariefsaid/PMO/issues/1017)) ([4d0a46d](https://github.com/ariefsaid/PMO/commit/4d0a46dcf226bc03a3a131cbfdff14f9b63116c7))
* **odoo:** fleet and maintenance kinds, asset discovery and capability gap ([#1511](https://github.com/ariefsaid/PMO/issues/1511) F1) ([fe90127](https://github.com/ariefsaid/PMO/commit/fe90127e3b4961382fcab30c211bbba6755a4d14))
* **odoo:** fleet and maintenance register through the outbox, sync follow-ups ([#1511](https://github.com/ariefsaid/PMO/issues/1511), [#1504](https://github.com/ariefsaid/PMO/issues/1504)) ([7db72f8](https://github.com/ariefsaid/PMO/commit/7db72f82196433629b48d33302154650057e2561))
* **odoo:** ledger lines show Showing x of y from the first page ([#2064](https://github.com/ariefsaid/PMO/issues/2064)) ([ad12511](https://github.com/ariefsaid/PMO/commit/ad12511accc4837c646303d444136a1a62d0d00f))
* **odoo:** plain notice with retry when the ledger-mode read fails ([#2065](https://github.com/ariefsaid/PMO/issues/2065)) ([b807400](https://github.com/ariefsaid/PMO/commit/b807400ce224f7f1bd350a6d9adb5c00cef1460b))
* **odoo:** record equipment and maintenance in Odoo through the outbox ([#1511](https://github.com/ariefsaid/PMO/issues/1511) F4) ([3d8751b](https://github.com/ariefsaid/PMO/commit/3d8751b35542f03cf9dd4343aaf5d4067b8e039e))
* **odoo:** setup screens for the record review, plan choice, send states and employ ([#2050](https://github.com/ariefsaid/PMO/issues/2050)) ([07747c5](https://github.com/ariefsaid/PMO/commit/07747c5568033d5acdba3ec063c0d94a6ebc377e))
* **pack:** recognise revenue from per-line earned value where a project has contract lines ([#1279](https://github.com/ariefsaid/PMO/issues/1279)) ([75fd990](https://github.com/ariefsaid/PMO/commit/75fd9901014b1a63c3771b64d9f9bc9a71f4a233))
* **revenue:** choose the client withholding article on receipts and per project ([#1275](https://github.com/ariefsaid/PMO/issues/1275)) ([0ab01e5](https://github.com/ariefsaid/PMO/commit/0ab01e5fdcfed0bf67cf99da2f8436fd00e43f4a))
* **revenue:** receipt withholding by tax article, slices 1-3 ([#1275](https://github.com/ariefsaid/PMO/issues/1275)) ([1a9d5f9](https://github.com/ariefsaid/PMO/commit/1a9d5f96214cbf7726671baa511023159249e427))


### Bug Fixes

* **#1458:** review r7 fixes (M365 notice back above the register, i18n gate scope, drawer double close, shared task view types) ([d080d4a](https://github.com/ariefsaid/PMO/commit/d080d4acfd7eaba11024c1ccd6977d712bdaa309))
* **budget:** activation resolves on the PMO write; ERP push runs in the background (ADR-0062, [#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([a567714](https://github.com/ariefsaid/PMO/commit/a567714879057c5a7af42b2e30f7bb6a900166dc))
* **budget:** activation settles the background push outcome through onPushSettled (ADR-0062, [#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([6e47711](https://github.com/ariefsaid/PMO/commit/6e4771101552e2ea5c6e9f5cf41decf7b2e52355))
* **budget:** attribute a resumed push to the version's activation actor ([cc374e3](https://github.com/ariefsaid/PMO/commit/cc374e3bf621ad2a7203525faa1fe635b2368bfd))
* **budget:** cancel/resume and archive-cancel reference, with the AC-018 journey ([#1472](https://github.com/ariefsaid/PMO/issues/1472)) ([93b9076](https://github.com/ariefsaid/PMO/commit/93b9076534708cc0a7c6c8b6a7184d871f7ec7b8))
* **budget:** paste dialog drops dead save guard; refreshBudgetQueries back to dev's prefixes ([#1473](https://github.com/ariefsaid/PMO/issues/1473) slice C) ([1a52058](https://github.com/ariefsaid/PMO/commit/1a52058d47419796a4f224b92107a335a5d6d014))
* **budget:** paste dialog passes a rejected row's error to EntityFormModal submitError (AC-ERR-001, [#1473](https://github.com/ariefsaid/PMO/issues/1473)) ([0488be8](https://github.com/ariefsaid/PMO/commit/0488be81c087c80bcb312c883cc730ee93cb83b1))
* **budget:** push status reads Queued from activation until the push settles ([#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([b3f42eb](https://github.com/ariefsaid/PMO/commit/b3f42ebdad596dc247e950d3925f8a06fe865bf4))
* **budget:** resume units parked behind an ERP archive cancellation ([6bbfbe7](https://github.com/ariefsaid/PMO/commit/6bbfbe795600ff17245b4d5ae0c382cf451ef677))
* **budgets:** bulk activation applies the Budget tab's distribution gate and names the real block reason ([#1273](https://github.com/ariefsaid/PMO/issues/1273)) ([781691a](https://github.com/ariefsaid/PMO/commit/781691ae84e23d132ebd7d1596531b04b61d82d1))
* **budgets:** bulk activation keeps a per-project outcome list, names empty ERP pushes, classifies errors, plural wording ([#1273](https://github.com/ariefsaid/PMO/issues/1273)) ([9614904](https://github.com/ariefsaid/PMO/commit/9614904cda1a018b4cdaa05f62e6456573bc51db))
* **budgets:** flag a bulk-activated draft whose ERP push failed ([#1273](https://github.com/ariefsaid/PMO/issues/1273)) ([49905be](https://github.com/ariefsaid/PMO/commit/49905be73f46c5ca72b9d8eb802cf98bc08563ab))
* **budget:** skip the Queued seed when the push settled before activation resolved ([#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([2b287ba](https://github.com/ariefsaid/PMO/commit/2b287badf0c19adfa6e2092202e73427a9ec6ecf))
* **budget:** skip the Queued seed when the push settled before activation returned ([#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([f3057c6](https://github.com/ariefsaid/PMO/commit/f3057c61cd3841dcaed0ac0e799d9e2a1a5c66d2))
* **erp-purchases:** defer an order unit whose item read cannot finish in the pass; add item_projects to the generated types ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([0aac015](https://github.com/ariefsaid/PMO/commit/0aac015feee3068e960c193b2a1a38bcee7e01b0))
* **erp-purchases:** restore the legacy-cursor check after the v4 namespace rename; correct the failed-write test for deferred order errors ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([398f3e6](https://github.com/ariefsaid/PMO/commit/398f3e630edf44d4ec1c42c19a3329dee29f8dae))
* **erpnext:** purchase order company, order guard and mirror customer heal, with test-bed journeys ([#1607](https://github.com/ariefsaid/PMO/issues/1607)) ([64a55a0](https://github.com/ariefsaid/PMO/commit/64a55a03b374602e4cbc3e3ef6e346b839c2d914))
* **erpnext:** purchase order, invoice and receipt bodies carry the binding company ([aa93d4e](https://github.com/ariefsaid/PMO/commit/aa93d4e17eaa4605b66380d6eae2c9f82f9519f1))
* **m365:** entitlement follows the resolved plan switch ([#1017](https://github.com/ariefsaid/PMO/issues/1017) S1) ([c1bafd6](https://github.com/ariefsaid/PMO/commit/c1bafd692d0dbb3fc6e606ebaa8b971a84970e3a))
* **odoo:** a login partner with a trade role is still a customer or vendor ([#2048](https://github.com/ariefsaid/PMO/issues/2048) [#2049](https://github.com/ariefsaid/PMO/issues/2049)) ([abe9cd2](https://github.com/ariefsaid/PMO/commit/abe9cd22fcc4d8f5a43a6d859978f7ac71acccdd))
* **odoo:** a project whose number or client code equals a cost account's code gets a link proposal ([#2052](https://github.com/ariefsaid/PMO/issues/2052)) ([b75b434](https://github.com/ariefsaid/PMO/commit/b75b43454aca805e66b4c8ad7729a95765a27b38))
* **odoo:** budget cards follow the Odoo figures and one currency on the tab ([#2066](https://github.com/ariefsaid/PMO/issues/2066)) ([5fa2802](https://github.com/ariefsaid/PMO/commit/5fa28022b44bd46d1d5ac5029e139b6344e9fbac))
* **odoo:** currency notice names budget, spending and commitments separately; deterministic Odoo company pick ([#2066](https://github.com/ariefsaid/PMO/issues/2066)) ([8bb9166](https://github.com/ariefsaid/PMO/commit/8bb91669decf0a6e94b66bfcefc1ca10642e69b1))
* **odoo:** every budget figure keeps its own currency; Odoo spend named at the finances read; partial Spent says so ([#2066](https://github.com/ariefsaid/PMO/issues/2066), [#2064](https://github.com/ariefsaid/PMO/issues/2064)) ([95d000e](https://github.com/ariefsaid/PMO/commit/95d000ee4a28b90dd917fc5dafbac21c58eec9d3))
* **odoo:** login users' partners never become master-data review rows ([#2049](https://github.com/ariefsaid/PMO/issues/2049)) ([37f7209](https://github.com/ariefsaid/PMO/commit/37f7209b9240eba4c70aa41884000e6a450bc34b))
* **odoo:** project send names the cost account with the PMO project number (FR-ODC-072) ([aa202f6](https://github.com/ariefsaid/PMO/commit/aa202f641f92737e270705bd76dadf989c2f0307))
* **odoo:** Re-check does one authenticated read, not full discovery ([#2051](https://github.com/ariefsaid/PMO/issues/2051)) ([4e60d8a](https://github.com/ariefsaid/PMO/commit/4e60d8a0ff40f19c2acde2e90d4db3375b3dc6db))
* **odoo:** Re-check runs discovery on a degraded or missing snapshot; correct the CPU claim ([#2051](https://github.com/ariefsaid/PMO/issues/2051)) ([caf4a16](https://github.com/ariefsaid/PMO/commit/caf4a1622f24259eab92092fd002d139c7b7925c))
* **odoo:** repair unit and type failures from the batch merge ([#2048](https://github.com/ariefsaid/PMO/issues/2048) [#2051](https://github.com/ariefsaid/PMO/issues/2051) [#2065](https://github.com/ariefsaid/PMO/issues/2065)) ([3122161](https://github.com/ariefsaid/PMO/commit/31221611a2255575c6c0d156aa318bf4722a0b34))
* **odoo:** sends-finished step shares the connect-status cache, ignores account reviews, hides for Finance; tests tighten ([#2053](https://github.com/ariefsaid/PMO/issues/2053)) ([fb6b881](https://github.com/ariefsaid/PMO/commit/fb6b881f53f797b288aac8334b3f7d1722e8d179))
* **odoo:** setup checklist sends step follows send state, not an unwritten marker ([#2053](https://github.com/ariefsaid/PMO/issues/2053)) ([d7e5eb7](https://github.com/ariefsaid/PMO/commit/d7e5eb7b89e0f302c33772fbbb08bff185ee34cd))
* **odoo:** the project link screen shows the connection banner; Map once completes for orgs that use no units ([c33abe0](https://github.com/ariefsaid/PMO/commit/c33abe01fe27e950e4321a941f65a7832b2b10db))
* **odoo:** the register refuses an id the book holds, binds a maintenance edit to its asset, and checks the ids a caller names ([#1511](https://github.com/ariefsaid/PMO/issues/1511) F4 review) ([086b020](https://github.com/ariefsaid/PMO/commit/086b0209e2f78412e71e3be924f1348404e04033))
* **odoo:** the setup census leaves out the partners Odoo holds for itself ([#2048](https://github.com/ariefsaid/PMO/issues/2048)) ([99ad91f](https://github.com/ariefsaid/PMO/commit/99ad91f29c0d502346746cf95ffa4678b9391fad))
* **revenue:** classify projects.receipt_withholding_article in change capture; enter amounts in the no-withholding receipt test ([#1275](https://github.com/ariefsaid/PMO/issues/1275)) ([7ebee2d](https://github.com/ariefsaid/PMO/commit/7ebee2d07138c41530090a0de1bc511e33d5da50))
* **revenue:** per-field Clear names, keep a hand-picked receipt article, omit stale project article ([#1275](https://github.com/ariefsaid/PMO/issues/1275)) ([12a0e68](https://github.com/ariefsaid/PMO/commit/12a0e680d3e72fa7820394db142a8c6f2a156e33))
* **revenue:** post receipt withholding to the prepaid account of its tax article ([#1275](https://github.com/ariefsaid/PMO/issues/1275)) ([f486b94](https://github.com/ariefsaid/PMO/commit/f486b9454f55054637ff59910b82470d07d2b730))


### Performance

* **budgets:** bulk-activation panel reads nothing until opened, caps readiness checks at 10, gates on role ([#1273](https://github.com/ariefsaid/PMO/issues/1273)) ([c93731e](https://github.com/ariefsaid/PMO/commit/c93731e0a36946d815c6e4cf3e92b95e81685d65))
* **i18n:** boot with only the common namespace, load feature catalogues on demand ([#2097](https://github.com/ariefsaid/PMO/issues/2097)) ([3ab1d7e](https://github.com/ariefsaid/PMO/commit/3ab1d7e0cc482d2d841ade2f46f50d59c9ef53b3))
* lazy translation namespaces and derived procurement figures ([#2097](https://github.com/ariefsaid/PMO/issues/2097), [#2101](https://github.com/ariefsaid/PMO/issues/2101)) ([1381df8](https://github.com/ariefsaid/PMO/commit/1381df878741d10a58c84c2a383f4a0fb19e29ac))
* **procurement:** derive each procurement row once instead of per call site ([#2101](https://github.com/ariefsaid/PMO/issues/2101)) ([9e677d0](https://github.com/ariefsaid/PMO/commit/9e677d01ee90fc7b5a219196a718c3b16dafab65))


### Refactors

* **budget:** drop the activation push-outcome toasts that ADR-0062 made unreachable ([#1030](https://github.com/ariefsaid/PMO/issues/1030)) ([43d0e8f](https://github.com/ariefsaid/PMO/commit/43d0e8f2e203c6ddf2ac7e6f5a36d4ec7e1bc440))

## [0.34.0](https://github.com/ariefsaid/PMO/compare/v0.33.0...v0.34.0) (2026-11-09)


### Features

* **assistant:** treat record text as data, same-origin answer links, safety eval cases ([#1743](https://github.com/ariefsaid/PMO/issues/1743)) ([2c20341](https://github.com/ariefsaid/PMO/commit/2c203412f317cf4fb601ee84c9006ffeb669c929))
* **assistant:** treat record text as data, show external links as text, add safety eval cases ([#1743](https://github.com/ariefsaid/PMO/issues/1743)) ([a52a82a](https://github.com/ariefsaid/PMO/commit/a52a82ad3a5301941fe2b4d62b92df9a80bc667a))
* batch — [#1980](https://github.com/ariefsaid/PMO/issues/1980) Gantt reschedule, [#1418](https://github.com/ariefsaid/PMO/issues/1418) dashboard attention ([6819b0e](https://github.com/ariefsaid/PMO/commit/6819b0e7eefae3ded8ee5de6428667e916f99341))
* batch — [#1982](https://github.com/ariefsaid/PMO/issues/1982) calendar, [#1983](https://github.com/ariefsaid/PMO/issues/1983) filter builder ([1241862](https://github.com/ariefsaid/PMO/commit/124186299d669cb797c1a149ece0ad78dbd56a30))
* **billing:** data layer and Billing tab invoice a signed-off T&M claim in PMO when no ERP owns revenue ([#1817](https://github.com/ariefsaid/PMO/issues/1817)) ([c6aeb61](https://github.com/ariefsaid/PMO/commit/c6aeb6191a25abd99a5287a9b4f1069758d9024a))
* **billing:** no-ERP orgs invoice a signed-off T&M claim ([#1817](https://github.com/ariefsaid/PMO/issues/1817)) ([eab1c8a](https://github.com/ariefsaid/PMO/commit/eab1c8a96557210b4dd5b74dec4fc96041202006))
* **companies,contacts:** server-side type/company filter, search and paging ([#1989](https://github.com/ariefsaid/PMO/issues/1989)) ([cf8312e](https://github.com/ariefsaid/PMO/commit/cf8312e95234437d4ca30fd02de444331b510da9))
* **dashboard:** rank the executive project list by attention, server-side ([#1418](https://github.com/ariefsaid/PMO/issues/1418)) ([34bdda1](https://github.com/ariefsaid/PMO/commit/34bdda15610af4dbfb8bf46051977c612330ee46))
* **gantt:** finish ReUI project Gantt (open on dated range, jsdom stubs, tests ported to bars) ([#1980](https://github.com/ariefsaid/PMO/issues/1980)) ([e9e7aa2](https://github.com/ariefsaid/PMO/commit/e9e7aa2674d64df59660e4a844f372be8dbca876))
* **odoo:** actuals, statements and ledger switch screens ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S7) ([446da01](https://github.com/ariefsaid/PMO/commit/446da0155d5f1fde952a357db730a5d35b6c79e4))
* **odoo:** contract-first ledger parts and actuals.read declaration ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S1) ([dbf1a28](https://github.com/ariefsaid/PMO/commit/dbf1a28e4234823c7509667fb1f71cd066cd320c))
* **odoo:** drain accepted master sends to Odoo; companies under Odoo ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S8 T1–T9) ([dd58a3e](https://github.com/ariefsaid/PMO/commit/dd58a3e5214076d6ce5592705d8ad03b01f6ce70))
* **odoo:** ledger parts for project actuals ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S1) ([5bf5ae8](https://github.com/ariefsaid/PMO/commit/5bf5ae89908c4766aa0229c396c92aefc3da2176))
* **odoo:** ledger reconciliation record and hourly health check ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S4) ([dca481f](https://github.com/ariefsaid/PMO/commit/dca481f9818f27a32880bda16c58e59588cd73ba))
* **odoo:** ledger reconciliation record, health, line list and hourly check ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S4, migration 0745) ([527099a](https://github.com/ariefsaid/PMO/commit/527099ab0821fa5682fe3d4bf06ab8ad71079f7c))
* **odoo:** map once at setup (account defaults, units, default warehouse) + link reconciliation ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S7) ([44a0c0f](https://github.com/ariefsaid/PMO/commit/44a0c0f8cae2f5357f616879c9e948a118b4abc3))
* **odoo:** map once, link reconciliation, resolvers ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S7), SQL in 0708 on top of shipped S6 ([8a6df34](https://github.com/ariefsaid/PMO/commit/8a6df3487b09e95a68ea219081121dd59daef537))
* **odoo:** procurement runs the shared link check before adapter selection; declare purchase, bill, payment, revise and receipt.read supported ([#1505](https://github.com/ariefsaid/PMO/issues/1505), [#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([463c362](https://github.com/ariefsaid/PMO/commit/463c362de26dfc9406dd2dc60f9178f956ffa566))
* **odoo:** project actuals and statement screens for Odoo-connected orgs ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S7) ([34f36f0](https://github.com/ariefsaid/PMO/commit/34f36f07e8cb4251da72bbe87cd5193923660836))
* **odoo:** send PMO masters to Odoo; companies command after employ ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S8) ([dc94167](https://github.com/ariefsaid/PMO/commit/dc94167835a85eb47f46a3da96a64e4e13befcdd))
* **odoo:** show Odoo tax documents as unavailable ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C7) ([c217b89](https://github.com/ariefsaid/PMO/commit/c217b8943b3ef3cdf3e00c6121fe3bfca8c624f4))
* **payments:** on-account receipts and allocation for no-ERP orgs ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([acf6b09](https://github.com/ariefsaid/PMO/commit/acf6b09f62b7fedc5c47afd4b97fdd76d40fb851))
* **projects:** filter builder tests, list-wide Clear all, namespaced i18n, orphan keys removed ([#1983](https://github.com/ariefsaid/PMO/issues/1983)) ([085d2a9](https://github.com/ariefsaid/PMO/commit/085d2a9c3d565dd36e8f692b5b5153941226eb66))
* **revenue:** apply a payment to invoices, unapply, on-account receipts and copy ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([5240c45](https://github.com/ariefsaid/PMO/commit/5240c457b32a4fc5bf99aedb541277be122ac138))
* **revenue:** repository, hooks, allocation display logic and generated types for payment allocation ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([8207354](https://github.com/ariefsaid/PMO/commit/8207354e21f2821661d69ba25f1cc0b8f35063a7))
* **sales:** CRM board as /sales, decision-first deal band, drop option scaffolding ([#1426](https://github.com/ariefsaid/PMO/issues/1426)) ([a20f470](https://github.com/ariefsaid/PMO/commit/a20f4704d3f758e7bd43e16b9cd884e017be2299))
* **sales:** restructured sales list and deal page ([#1426](https://github.com/ariefsaid/PMO/issues/1426)) + [#1344](https://github.com/ariefsaid/PMO/issues/1344) test waits ([5525f35](https://github.com/ariefsaid/PMO/commit/5525f35087b9e4ebaffe861b2284602142f10281))
* show Odoo tax documents as unavailable ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C7) ([58b0743](https://github.com/ariefsaid/PMO/commit/58b07435f75fde1cb5aff954c92d8d7ea8192cbc))
* **ui:** motion polish — button press, shorter exits, menus from trigger, save pulse, icon crossfades ([#1970](https://github.com/ariefsaid/PMO/issues/1970)) ([4094cb7](https://github.com/ariefsaid/PMO/commit/4094cb795b6c29c5ce014da752cb05b45e922b22))


### Bug Fixes

* **#1240:** show active budget beside spending-vs-contract bar; name the invoiced trend chart (D-005, D-009) ([b191334](https://github.com/ariefsaid/PMO/commit/b191334ed3b1048a1f9a8799d6d59202b3fcd0b3))
* **#1461:** keep the status tabs keyboard-reachable when a dashboard drill filter has no tab ([18b8f8d](https://github.com/ariefsaid/PMO/commit/18b8f8d51b97700ec03e514d19a319cf20afa058))
* **agent:** whats_overdue reads the shared open-client-invoice status rule like the app ([#2015](https://github.com/ariefsaid/PMO/issues/2015)) ([d89e419](https://github.com/ariefsaid/PMO/commit/d89e419398338c11b8e34d5ac5a349eae9c3f089))
* **assistant:** envelope write results and prepare refusals, keep server notes outside it, tighten safety eval scorers ([#1743](https://github.com/ariefsaid/PMO/issues/1743)) ([e97cd5d](https://github.com/ariefsaid/PMO/commit/e97cd5ddea5cf1fefc4d6d55052f4013e692143c))
* **assistant:** hold the Ask AI draft in runtime state so a lazily mounted panel still shows it ([#1978](https://github.com/ariefsaid/PMO/issues/1978)) ([c1f4332](https://github.com/ariefsaid/PMO/commit/c1f433224355073f0b245c291a77170c7706768a))
* **assistant:** keep the Ask AI draft when the lazily loaded panel mounts late ([8e7f633](https://github.com/ariefsaid/PMO/commit/8e7f63319d60485fb7c5af6ef063712f1bf4e7fb))
* batch — [#1288](https://github.com/ariefsaid/PMO/issues/1288) M365 linking polish, [#1461](https://github.com/ariefsaid/PMO/issues/1461) drill-through, [#2015](https://github.com/ariefsaid/PMO/issues/2015) assistant overdue rule ([6f1e1d6](https://github.com/ariefsaid/PMO/commit/6f1e1d6bda5badfe49e7f5a279f1127217728921))
* batch — [#1456](https://github.com/ariefsaid/PMO/issues/1456), [#1240](https://github.com/ariefsaid/PMO/issues/1240) [#1339](https://github.com/ariefsaid/PMO/issues/1339), [#1607](https://github.com/ariefsaid/PMO/issues/1607) ([5a4a5a4](https://github.com/ariefsaid/PMO/commit/5a4a5a4d0717fa7d6b948dcf67438463a0531ec6))
* batch — [#1970](https://github.com/ariefsaid/PMO/issues/1970), [#1453](https://github.com/ariefsaid/PMO/issues/1453), [#1175](https://github.com/ariefsaid/PMO/issues/1175) [#1223](https://github.com/ariefsaid/PMO/issues/1223) [#1226](https://github.com/ariefsaid/PMO/issues/1226) ([ae06fa0](https://github.com/ariefsaid/PMO/commit/ae06fa069609718644189902ecdd6c036c69d0a3))
* batch — statement sync scheduled refetch + recovery scan, PipelineLens i18n ([c9e132e](https://github.com/ariefsaid/PMO/commit/c9e132ea5fca224d2c282ba4186d1351606b0fbf))
* **budget-push:** record refused pushes, bound finalize retries ([#1364](https://github.com/ariefsaid/PMO/issues/1364), [#1371](https://github.com/ariefsaid/PMO/issues/1371)) ([8deac91](https://github.com/ariefsaid/PMO/commit/8deac91315641b881a7c1a7a891f4257a5582d8f))
* **budget:** a refused budget push is recorded, and the finalize retry is bounded ([#1364](https://github.com/ariefsaid/PMO/issues/1364)) ([e8b49ba](https://github.com/ariefsaid/PMO/commit/e8b49ba44dd44357a3b1cb6b6674b88ef4eea4fd))
* **calendar:** month bar overlay is a gridcell so axe is clean ([#1982](https://github.com/ariefsaid/PMO/issues/1982)) ([345350d](https://github.com/ariefsaid/PMO/commit/345350dccec80c6fe133f2722f5ea9ebab85ba1b))
* **calendar:** own calendar i18n namespace instead of common allowlist bypass ([#1982](https://github.com/ariefsaid/PMO/issues/1982)) ([10936fe](https://github.com/ariefsaid/PMO/commit/10936fee0b645a07779818797ddbf2a20f285e80))
* **calendar:** readable destructive text on the destructive tint ([#1982](https://github.com/ariefsaid/PMO/issues/1982)) ([82f75bc](https://github.com/ariefsaid/PMO/commit/82f75bce19be44f5dd105c612064264763bc157a))
* **calendar:** typecheck, guards (shadow-type, i18n allowlist, module registry), e2e fonts wait, eslint ([#1982](https://github.com/ariefsaid/PMO/issues/1982)) ([3756312](https://github.com/ariefsaid/PMO/commit/37563121b925489f2cecf314a840704071bfd3fa))
* **companies,contacts:** out-of-range directory page is an empty page over the real total, not a 416 error ([#1989](https://github.com/ariefsaid/PMO/issues/1989)) ([95b0c40](https://github.com/ariefsaid/PMO/commit/95b0c4079a03aca0294f8cb6b172d6d0d552c1a2))
* **crm:** trim paged activity timelines to page one on every write ([#1990](https://github.com/ariefsaid/PMO/issues/1990)) ([7074660](https://github.com/ariefsaid/PMO/commit/707466004edc4c31a7d309ddff1225476e58a8c8))
* **crm:** type the paged activity query without a generic instantiation ([#1990](https://github.com/ariefsaid/PMO/issues/1990)) ([d761803](https://github.com/ariefsaid/PMO/commit/d7618039368992195cba7c37d9f19c972abad1be))
* **dashboard:** stable Needs-You currency order; closed-record orgs keep the dashboard ([#1973](https://github.com/ariefsaid/PMO/issues/1973)) ([55d7603](https://github.com/ariefsaid/PMO/commit/55d76030f7dff3c0a49b98e8f600440560e1ae45))
* **db:** name who detaches in the purchase-move refusal; cover Rejected; add AC-JEC-020 ([#1935](https://github.com/ariefsaid/PMO/issues/1935)) ([0e8a6fd](https://github.com/ariefsaid/PMO/commit/0e8a6fdabf15cc55b1263252f2b80943b7ea0cf4))
* drive the real e-Faktur save path in the tax-document claim test; clear wording beside a recorded e-Faktur ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C7) ([b1d745a](https://github.com/ariefsaid/PMO/commit/b1d745a3595ff0a486102b87ce03576640961d8f))
* **e2e:** AC-MTG-060 newest-first oracle tolerates parallel specs' meetings ([#1968](https://github.com/ariefsaid/PMO/issues/1968)) ([2131773](https://github.com/ariefsaid/PMO/commit/2131773fc64a5c50bb39226e98555a7a9084d910))
* **e2e:** release journeys follow the deal preview drawer and the ERP purchases tab ([9525b7d](https://github.com/ariefsaid/PMO/commit/9525b7d3ba82f8e928a865df65b4b4c10c98c430))
* **e2e:** route every serial spec's direct bench calls through the local-bench guard ([#2036](https://github.com/ariefsaid/PMO/issues/2036)) ([b9ad581](https://github.com/ariefsaid/PMO/commit/b9ad581c5d08764e8a6cca9a2a9711ab2a83a65b))
* **e2e:** S15-004 locale via profile read not dev-only import; ignore dist-consent; reject unknown E2E_SERVER ([#1968](https://github.com/ariefsaid/PMO/issues/1968)) ([5659104](https://github.com/ariefsaid/PMO/commit/565910494cbee39fb91a4ac7adbe2a8f8fe95257))
* **e2e:** serial helpers refuse non-local ERP bench hosts unless opted in ([#1359](https://github.com/ariefsaid/PMO/issues/1359)) ([d500f96](https://github.com/ariefsaid/PMO/commit/d500f967d166a433c0339cb7e0b2ae1ed7e88347))
* **e2e:** serve CI browser lanes a production build, not the dev server ([#1968](https://github.com/ariefsaid/PMO/issues/1968)) ([28ffddf](https://github.com/ariefsaid/PMO/commit/28ffddfbf9da026c20a8db1877b289dc0766e931))
* **erp-connect:** own company by partner id; refuse linking an Internal company; adapters declare the project field ([1b2a230](https://github.com/ariefsaid/PMO/commit/1b2a230fecd0f38d48432af921840af9dc84151a))
* **erp:** move watermark helpers to shared module ([#1276](https://github.com/ariefsaid/PMO/issues/1276)) ([3fbd668](https://github.com/ariefsaid/PMO/commit/3fbd668bac8d5cb3f3c482acbf006866335afeb5))
* **finance:** allowlist new feature-section i18n keys; type the link-confirm test options ([#1175](https://github.com/ariefsaid/PMO/issues/1175) [#1223](https://github.com/ariefsaid/PMO/issues/1223) [#1226](https://github.com/ariefsaid/PMO/issues/1226)) ([6ba026a](https://github.com/ariefsaid/PMO/commit/6ba026a37b41301e19ce90e6fd27fa932e8c25fc))
* **finance:** invoice saved customer filter reads loading until options resolve ([#1175](https://github.com/ariefsaid/PMO/issues/1175)) ([99161df](https://github.com/ariefsaid/PMO/commit/99161dfd45edbaef6e7393caf8ff79ebbbb6aa9e))
* **finance:** split PMO spend into paid (Spent) and unpaid (Committed) everywhere for orgs without an accounting system ([d1947f8](https://github.com/ariefsaid/PMO/commit/d1947f807eba45d0622fbd74d02f6b6a1e80c7df))
* **financial-statements:** poll the statement read after an accepted Refresh now ([#1930](https://github.com/ariefsaid/PMO/issues/1930)) ([3d70a64](https://github.com/ariefsaid/PMO/commit/3d70a649b9b2b259d098718bb447dd9990b4ec39))
* **financial-statements:** refetch the statement after an accepted Refresh now ([#1930](https://github.com/ariefsaid/PMO/issues/1930)) ([04db8e0](https://github.com/ariefsaid/PMO/commit/04db8e06ee88d4d5b70e293966c46c2dbfe4f391))
* **gantt:** row actions button, per-drag rollback, drag e2e and onReschedule tests ([#1980](https://github.com/ariefsaid/PMO/issues/1980)) ([024eb0c](https://github.com/ariefsaid/PMO/commit/024eb0c12aeca1483eb505cc5322f6a052bcfd3f))
* **gantt:** text-destructive-text on destructive tints ([#1980](https://github.com/ariefsaid/PMO/issues/1980)) ([8878aa9](https://github.com/ariefsaid/PMO/commit/8878aa941c58cd2d854c00d78adacd73a484f4e3))
* **gantt:** widen default task panel so status and dates show ([#1980](https://github.com/ariefsaid/PMO/issues/1980)) ([fb89324](https://github.com/ariefsaid/PMO/commit/fb893242d2805d9e8cb0087da80095e40256c741))
* **i18n:** translate PipelineLens pipeline stage and vocabulary labels ([#2000](https://github.com/ariefsaid/PMO/issues/2000)) ([ee5eb5d](https://github.com/ariefsaid/PMO/commit/ee5eb5d4b747fc2b6e052eee6c61365860aeb1d7))
* **incidents:** Export delivers every incident matching the filter, not just the page ([#1991](https://github.com/ariefsaid/PMO/issues/1991)) ([1444512](https://github.com/ariefsaid/PMO/commit/1444512660fd1412b4102555309e838051ce4049))
* **integrations:** Check again button uses a valid outline variant ([#1607](https://github.com/ariefsaid/PMO/issues/1607)) ([65b13a3](https://github.com/ariefsaid/PMO/commit/65b13a30cba1fbdd8ed8b01fab897d8ac3d77f22))
* **integrations:** Match records starts the census on first open; add Check again ([#1607](https://github.com/ariefsaid/PMO/issues/1607)) ([2306eb3](https://github.com/ariefsaid/PMO/commit/2306eb325c8e1edf544d102f536f166c70f7907e))
* **invoices:** e-Faktur only on VAT projects ([#1506](https://github.com/ariefsaid/PMO/issues/1506) AC-OCI-081) ([4ef24af](https://github.com/ariefsaid/PMO/commit/4ef24af951644bc09bc6b7c6567410361c6c3264))
* **invoices:** native sales invoices require a client company ([#2003](https://github.com/ariefsaid/PMO/issues/2003)) ([59b154a](https://github.com/ariefsaid/PMO/commit/59b154a9cd050230110abb64976f190739ee3b94))
* **lint:** every import boundary survives flat-config rule replacement ([#1456](https://github.com/ariefsaid/PMO/issues/1456)) ([0a8777a](https://github.com/ariefsaid/PMO/commit/0a8777a052a5fcd4fc1dd0ab7cdca6779a615f93))
* **m365:** archived budget evidence copy true with or without an existing draft ([#1288](https://github.com/ariefsaid/PMO/issues/1288)) ([fffcf89](https://github.com/ariefsaid/PMO/commit/fffcf89ac50199d40571b2ee435c1ecb5d1d681f))
* **m365:** versions modal one close, clearer revision/version verbs, link-existing-folders own card and read-failure state ([#1288](https://github.com/ariefsaid/PMO/issues/1288) F13 F15 F16) ([3bbefe0](https://github.com/ariefsaid/PMO/commit/3bbefe049533fe4df516f6f53a6694276f50f409))
* **money:** Finance home labels its purchase figure by basis; uncategorized paid counts; restore dropped coverage ([#1739](https://github.com/ariefsaid/PMO/issues/1739)) ([8ad92b8](https://github.com/ariefsaid/PMO/commit/8ad92b829d1ec1bc469eca7242594e595ced32b9))
* **money:** per-currency payment ceiling, own-currency decision panel figures, real reissue hold reason ([#1354](https://github.com/ariefsaid/PMO/issues/1354)) ([c527aa1](https://github.com/ariefsaid/PMO/commit/c527aa13af8f081ec262da780fee04e54a03b3ea))
* **money:** Projects list and dashboards split PMO spend like the Budget tab ([#1739](https://github.com/ariefsaid/PMO/issues/1739)) ([cae9cfb](https://github.com/ariefsaid/PMO/commit/cae9cfb7ccd0aa57a04b21dd8d230798a75a032a))
* **odoo:** companies tier check via ownership seam helper (AC-ECA-043, [#1504](https://github.com/ariefsaid/PMO/issues/1504) S8) ([1fea9d7](https://github.com/ariefsaid/PMO/commit/1fea9d76e3d1758b27c174458083f052e1738625))
* **odoo:** currency on ledger figures, debits and credits shown apart, demo SQL undo note ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S7) ([1e22a74](https://github.com/ariefsaid/PMO/commit/1e22a74dcae0c23b2560417aa3189c78bc66c0dc))
* **odoo:** label ledger amounts in the Odoo company currency ([#1507](https://github.com/ariefsaid/PMO/issues/1507) S7) ([773fc43](https://github.com/ariefsaid/PMO/commit/773fc43d78927a5c0313be4beef4f2ba7642582d))
* **odoo:** procurement dispatch runs the shared link check first; Odoo shared-suite parity flips ([#1505](https://github.com/ariefsaid/PMO/issues/1505), [#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([950fa1f](https://github.com/ariefsaid/PMO/commit/950fa1f19522644cf634e1c1e148cef95123691b))
* **odoo:** project link tier check via ownership seam helper (AC-ECA-043, [#1504](https://github.com/ariefsaid/PMO/issues/1504) S7) ([01839cc](https://github.com/ariefsaid/PMO/commit/01839cc355a5525327b4931b9cc6ec789a913886))
* **odoo:** receipt flag clears on Odoo evidence, not two clocks ([#1825](https://github.com/ariefsaid/PMO/issues/1825)) ([1fce7e9](https://github.com/ariefsaid/PMO/commit/1fce7e996b896d3d3a7e92929690d30f0189213e))
* **odoo:** receipt read-back lands through one atomic merge, replay-tolerant ([#1825](https://github.com/ariefsaid/PMO/issues/1825)) ([70a8d4e](https://github.com/ariefsaid/PMO/commit/70a8d4e8b5518a11b0aa0c036852e8960a6e51c8))
* **odoo:** S7 review round: one cached ERP read on project detail, validate only changed map values, refuse mixed save bodies ([#1504](https://github.com/ariefsaid/PMO/issues/1504)) ([2c303fb](https://github.com/ariefsaid/PMO/commit/2c303fbe3607d7069956a8a8694f2c87cbbc3e3e))
* **odoo:** the partner feed tells PMO's own company apart by its partner id, not its name ([#1690](https://github.com/ariefsaid/PMO/issues/1690)) ([8911171](https://github.com/ariefsaid/PMO/commit/891117148e823138a7c7e6d566d0ac7c878268ce))
* **perf:** contain a failed assistant-panel chunk to the panel (Retry, stale-chunk guard), restore focus on late mount, pin entry preload list ([f759b32](https://github.com/ariefsaid/PMO/commit/f759b323990d6bd05d1a5faf7676730b98469eb8))
* **perf:** picker read uses the typed status list (typecheck) ([89862b6](https://github.com/ariefsaid/PMO/commit/89862b61aa30a38392ba11df059880efe1e2a9d9))
* **procurement:** ERP-owned orgs record orders through the ERP ([#1607](https://github.com/ariefsaid/PMO/issues/1607)) ([f35610e](https://github.com/ariefsaid/PMO/commit/f35610eb81638452e2e5bcac27028f9177474e56))
* **procurement:** per-currency billed ceiling on payments; decision panel shows each figure in its own currency ([8e5083b](https://github.com/ariefsaid/PMO/commit/8e5083beca524ec26aa6fa4f0b46b55f12fbe9f0))
* **procurement:** plain-words reasons for PO revise refusals and accurate held message ([#1998](https://github.com/ariefsaid/PMO/issues/1998)) ([c52d9e8](https://github.com/ariefsaid/PMO/commit/c52d9e80c73ff451c4e5ea58571fe73a869ab9ca))
* **procurement:** refuse moving a draft purchase with attached ERP journal lines ([#1935](https://github.com/ariefsaid/PMO/issues/1935)) ([082204b](https://github.com/ariefsaid/PMO/commit/082204be503d4f13be57eed49e05150d5f33a480))
* **projects:** localise the unlink-timeout detail and drop the reload instruction ([#1223](https://github.com/ariefsaid/PMO/issues/1223)) ([1fb5fbb](https://github.com/ariefsaid/PMO/commit/1fb5fbbf41a9c35a7934334de9692477b4863c6a))
* **projects:** neutral unlink copy for the timeout family and refetch bindings ([#1223](https://github.com/ariefsaid/PMO/issues/1223)) ([1027a9c](https://github.com/ariefsaid/PMO/commit/1027a9c42c8aea1e3fe92f822d2f8bca090277ce))
* Record order on an ERP-owned purchase opens the Purchase Order capture instead of minting a PMO-only order ([#1607](https://github.com/ariefsaid/PMO/issues/1607)) ([0024333](https://github.com/ariefsaid/PMO/commit/0024333948ef1be079f0d36ce461905f66e12f38))
* **revenue:** a PMO-native sales invoice requires a client company ([#2003](https://github.com/ariefsaid/PMO/issues/2003)) ([187af63](https://github.com/ariefsaid/PMO/commit/187af63715c16de243f319adf7732c7b0aae9ee0))
* **revenue:** allow the 0731 refusal codes in analytics; cite 42501 raise lines in isolation denominator ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([873bbb2](https://github.com/ariefsaid/PMO/commit/873bbb27cb937200dedcd5fdc38b532db59b21d9))
* **revenue:** e-Faktur hidden only when the project is outside VAT, not when tax is 0; seed AC-OCI-100 as a VAT project ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([0d8fbb1](https://github.com/ariefsaid/PMO/commit/0d8fbb11384662025e7eb8257d38998935a18975))
* **revenue:** no e-Faktur on an invoice with no VAT, in the UI and the setter; AC-OCI-092 proofs ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([2ec420c](https://github.com/ariefsaid/PMO/commit/2ec420c7ac824115354d68731d7608434f412e1e))
* **revenue:** order the allocation consistency trigger after the org stamp; known multi-FK pair; @/test imports ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([c661982](https://github.com/ariefsaid/PMO/commit/c6619828240497ebd564b54b9162d21ad93e727a))
* **sales:** one phone search, one stage control in B, figures row on phone for A/B/C ([#1426](https://github.com/ariefsaid/PMO/issues/1426)) ([ee56abf](https://github.com/ariefsaid/PMO/commit/ee56abfebc130341f62ba935f3080a1974764c5c))
* **sales:** option C RowMenu import, options test import and tab role ([#1426](https://github.com/ariefsaid/PMO/issues/1426)) ([6512d5e](https://github.com/ariefsaid/PMO/commit/6512d5e6cf185656d53184681e63c349da4cea81))
* **sales:** options pass axe and detector; board rail above board, plain read-only notice ([#1426](https://github.com/ariefsaid/PMO/issues/1426)) ([98ba157](https://github.com/ariefsaid/PMO/commit/98ba157a30276cb80d55ab1bcd0381fbd52149cb))
* statement refresh polls until republished; integrations split + setup-incomplete notice; Lighthouse baseline script ([07b95c3](https://github.com/ariefsaid/PMO/commit/07b95c3733818db9b4e19e54f9e5f55151289066))
* **timesheets:** carry the employee choice identity into the link dialog ([#1226](https://github.com/ariefsaid/PMO/issues/1226)) ([507a0ee](https://github.com/ariefsaid/PMO/commit/507a0ee5676c287184e7be438532e5a2b4c3ce90))
* **ui:** button spinner rotates (swap-in on wrapper), Crossfade shrink-0 ([#1970](https://github.com/ariefsaid/PMO/issues/1970)) ([0ef52c6](https://github.com/ariefsaid/PMO/commit/0ef52c68f7475395b8a90804398f531a354d795f))


### Performance

* **#1741:** keep root axe-core and libc fields in lock, refuse remote lighthouse targets, correct env note ([a2218a1](https://github.com/ariefsaid/PMO/commit/a2218a14c26f1af8e867125a026573a66a5d9cca))
* **#1741:** Lighthouse user-flow script and baseline table ([8d5db1e](https://github.com/ariefsaid/PMO/commit/8d5db1e8f609025c62b3a0f8dd796a2229586e86))
* **approvals:** the queue reads only Requested procurements, server-filtered under its own key ([197953c](https://github.com/ariefsaid/PMO/commit/197953c2d5ee55f09d17fbf2657b7e5883e19bec))
* **assistant:** mount the panel and fetch its chunk on first open only ([517d8d4](https://github.com/ariefsaid/PMO/commit/517d8d425b0c8421e2ae785283929b314ad90623))
* batch — [#1898](https://github.com/ariefsaid/PMO/issues/1898) load-run script, DataTable seam render ([09305dc](https://github.com/ariefsaid/PMO/commit/09305dc85b5db4b755d521cb71799d91c46974f3))
* batch — [#1990](https://github.com/ariefsaid/PMO/issues/1990) activity timelines, approvals queue read ([430f81a](https://github.com/ariefsaid/PMO/commit/430f81af8023df2c861bf2726c47e89bc26f62f4))
* batch — [#1991](https://github.com/ariefsaid/PMO/issues/1991) incidents paging, timesheets 12-week window ([2951c15](https://github.com/ariefsaid/PMO/commit/2951c15a030bd57913c3953f5513eace9d66916b))
* batch — first-frame layout on project detail, assistant panel loads on first open ([3709560](https://github.com/ariefsaid/PMO/commit/37095601b891ceae896f1861254d4339cd0d5cc9))
* batch — project pickers narrow read, procurement list render ([6720c52](https://github.com/ariefsaid/PMO/commit/6720c525ec455a8be24c28cfdf14c09c9a408859))
* batch — purchase re-stamp once per tick, ERP purchases cleanup, Lighthouse re-baseline ([148af3a](https://github.com/ariefsaid/PMO/commit/148af3a806e08eb9125b1ab7fe9861a804c4bbfa))
* **build:** keep shared shims out of vendor-recharts; lazy-load the assistant panel so the entry stops preloading charts and markdown ([2b8e2b3](https://github.com/ariefsaid/PMO/commit/2b8e2b3876d36cefc9d0a4cf6e5be45142bfc386))
* dashboard narrow reads + layout stability; probe expectations ([faad432](https://github.com/ariefsaid/PMO/commit/faad432508d7ca66b0bbb553f8a73dc78c5c759d))
* **dashboard:** existence probes only when all other activity signals are empty ([#1973](https://github.com/ariefsaid/PMO/issues/1973)) ([d7bdaf5](https://github.com/ariefsaid/PMO/commit/d7bdaf5614a303812eb6792fbc054b5114b0f1b9))
* **dashboard:** reserve loaded space for approvals, figure tiles, invoiced trend and header so the first paint stops shifting ([98320eb](https://github.com/ariefsaid/PMO/commit/98320eb225308bcc99404e421b79a1ea9c2671af))
* **dashboard:** reserve the invoiced-trend card before the org day resolves; fit the approvals skeleton to the strip ([120d171](https://github.com/ariefsaid/PMO/commit/120d1713b0e48b48875cfdf3f9e075ad43a423e7))
* **datatable:** subscribe the seam strips with useSyncExternalStore ([53884e6](https://github.com/ariefsaid/PMO/commit/53884e6872a0812839cfd48ba763acf6fa43575a))
* **directory:** server-side filter, search and paging for Companies and Contacts ([#1989](https://github.com/ariefsaid/PMO/issues/1989)) ([5cabee5](https://github.com/ariefsaid/PMO/commit/5cabee5b3d51f201d5439067e6955fcb4c18851c))
* **erp:** purchase upsert re-stamps once per tick, not per page ([#1290](https://github.com/ariefsaid/PMO/issues/1290)) ([93bcc50](https://github.com/ariefsaid/PMO/commit/93bcc503b29748684dcddca9eeeeed6f04cb74d0))
* **finance-hub:** read the hub's three figures from one narrow aggregate ([#1988](https://github.com/ariefsaid/PMO/issues/1988)) ([d7b9501](https://github.com/ariefsaid/PMO/commit/d7b95019ad95d3ee0e026ae56d766958f7d30d1c))
* **finance:** finance hub 11 to 7 requests ([bbdfadb](https://github.com/ariefsaid/PMO/commit/bbdfadb7d32286e19f2004b63cb2561113a1ce8c))
* **finance:** Finance hub reads its three figures from one narrow query ([#1988](https://github.com/ariefsaid/PMO/issues/1988)) ([26f337f](https://github.com/ariefsaid/PMO/commit/26f337fd986b8a2c2f0d4221de50343193496266))
* first-load JS, shell and page re-renders, dashboard actuals cost; dashboard currency order ([741e7c3](https://github.com/ariefsaid/PMO/commit/741e7c311b97e43883c6cdacfc7871fc69d88a23))
* **incidents:** server-side status filter, search and paging (WIP, [#1991](https://github.com/ariefsaid/PMO/issues/1991)) ([4babb08](https://github.com/ariefsaid/PMO/commit/4babb08b8b34f2b0278af6f2dc63ee834a792838))
* **layout:** skip Tabs first-mount scroll on first tab; content-visibility on overview delivery block ([6052f52](https://github.com/ariefsaid/PMO/commit/6052f5253e2d0430bebabc836274d30012a28e99))
* **procurement:** compute open commitments for the list in one set-based call ([fa25e0f](https://github.com/ariefsaid/PMO/commit/fa25e0fff800af9d2fe7518940a642fd0acbee57))
* **procurement:** cut per-settle render work on the procurement list ([ec25f21](https://github.com/ariefsaid/PMO/commit/ec25f2188247aba78e95481da25167ee5f629bfb))
* **procurement:** open commitment for the list in one set-based call (0723) ([9c5c319](https://github.com/ariefsaid/PMO/commit/9c5c319242230e45ca9f50c977cc4934a76cde31))
* **project-detail:** memoise Overview blocks, split the agent-context write side, seed the locale caches ([f152078](https://github.com/ariefsaid/PMO/commit/f152078f72759f6a39bbe2791ace4716637b5192))
* **projects:** drop unused advanced filters, dnd, date, columns, virtual cascader paths and @tanstack/react-virtual ([#1983](https://github.com/ariefsaid/PMO/issues/1983)) ([5f9bdaa](https://github.com/ariefsaid/PMO/commit/5f9bdaa40a8116f3e78056ba7917d4474c6e0f72))
* **shell:** memoise Rail, ContextBar and AppRoutes so record-cache settles stop re-rendering the shell ([d20df9e](https://github.com/ariefsaid/PMO/commit/d20df9e1be262d64e894170130d86582a8bf415c))


### Refactors

* **#1457:** one shared rule for the overdue client invoice ([320ec32](https://github.com/ariefsaid/PMO/commit/320ec320ecd40e7b53928e7dd5c8959a573b4c89))
* **#1459:** billingMilestones and workOrderBilling use the shared toCents ([57c6920](https://github.com/ariefsaid/PMO/commit/57c6920e2f0f0789418a22acd5a513e52d6c1d55))
* **#1459:** one shared helper per duplicated piece from the four-screen restructure ([7d285cf](https://github.com/ariefsaid/PMO/commit/7d285cf1c165a05099fb9daca0f324cbdb1fc692))
* batch — [#1457](https://github.com/ariefsaid/PMO/issues/1457) overdue rule, [#1459](https://github.com/ariefsaid/PMO/issues/1459) helper dedupe, [#1998](https://github.com/ariefsaid/PMO/issues/1998) revise wording ([1e9c1b5](https://github.com/ariefsaid/PMO/commit/1e9c1b5c695f59b75e6aada1c04ef787980aabd1))
* **erp-purchases:** remove the orphan presence probe left dead by the [#806](https://github.com/ariefsaid/PMO/issues/806) restructure ([81ffdd5](https://github.com/ariefsaid/PMO/commit/81ffdd55d1247a2ccaf6470dc6092f30ed756ad5))
* **integrations:** split IntegrationsView; show incomplete connections with Retry ([#1941](https://github.com/ariefsaid/PMO/issues/1941)) ([cadfc8b](https://github.com/ariefsaid/PMO/commit/cadfc8b0fabb2a2fed30d536fab84990fa63ca81))
* **odoo:** each connect adapter declares the PMO project field its code matches on ([#1692](https://github.com/ariefsaid/PMO/issues/1692)) ([6bea733](https://github.com/ariefsaid/PMO/commit/6bea733557b9b700e6707db3b73be1ac5b764682))
* **payments:** applicableInvoices in its own module (fast-refresh lint) ([#1415](https://github.com/ariefsaid/PMO/issues/1415)) ([ad9d3a3](https://github.com/ariefsaid/PMO/commit/ad9d3a3293bc84a5978ced8c11de502da8afaaaa))
* shared calculations move from pages/ into src ([#1456](https://github.com/ariefsaid/PMO/issues/1456)) ([5d46c5b](https://github.com/ariefsaid/PMO/commit/5d46c5bd99ccba0ff21ba1499eb2e9d66ca591f5))

## [0.33.0](https://github.com/ariefsaid/PMO/compare/v0.32.0...v0.33.0) (2026-11-06)


### Features

* **1919:** CLI journals/attach-journals, API tier 0688, runbook, e2e journey (S5, S6) ([80b8a3a](https://github.com/ariefsaid/PMO/commit/80b8a3adfddee7bac317c654bc0882e2fbfcaa7a))
* **1919:** fetch and mirror the GL remark (S1 app part) ([0b57225](https://github.com/ariefsaid/PMO/commit/0b57225a6c74428cb0efa13dacdc6867df519419))
* **1919:** journal cost lines, attach/detach, count once (0687, S2) ([3a59526](https://github.com/ariefsaid/PMO/commit/3a59526db3fb0c3c81cab074b38c762d3ad27d62))
* **1919:** journal lines on the project and the purchase (S3, S4) ([eeae762](https://github.com/ariefsaid/PMO/commit/eeae76255b3f29c0b19191612f4f2ef6abc50a33))
* **budget:** Forecast works with no ERP calendar ([#1472](https://github.com/ariefsaid/PMO/issues/1472) S7) ([3f595df](https://github.com/ariefsaid/PMO/commit/3f595df9539030e4e7fdc4bac77feb0a4b85947b))
* **budget:** paste rows data path, slice B ([#1473](https://github.com/ariefsaid/PMO/issues/1473)) ([b4c0e09](https://github.com/ariefsaid/PMO/commit/b4c0e0997f7701f3ed506d05da454f1f9725027b))
* **budgets:** stale whole-project distribution banner, CLI refuses whole-project loads ([#1472](https://github.com/ariefsaid/PMO/issues/1472) 6.5, 6.7) ([63e0aca](https://github.com/ariefsaid/PMO/commit/63e0aca52c14a5efc54bb326b519f1b319766fd2))
* **budget:** whole-project budgets with yearly spread, S6 ([#1472](https://github.com/ariefsaid/PMO/issues/1472)) ([0bfc206](https://github.com/ariefsaid/PMO/commit/0bfc2068f797e2ef64587f74a0674f5ac9990ccb))
* **budget:** whole-project forecast, S7 ([#1472](https://github.com/ariefsaid/PMO/issues/1472)) ([9031f31](https://github.com/ariefsaid/PMO/commit/9031f31250dcab05130b42b5a1e7de3df3c1641b))
* **erp:** journal cost lines on the project, counted once ([#1919](https://github.com/ariefsaid/PMO/issues/1919) part 1) ([0c390a9](https://github.com/ariefsaid/PMO/commit/0c390a9a7a8a9cb174b81a95cbc037255c75580a))
* **erp:** journal costs on the project page, attach to purchases, CLI ([#1919](https://github.com/ariefsaid/PMO/issues/1919) part 2) ([f2f8cf5](https://github.com/ariefsaid/PMO/commit/f2f8cf57b96db676bf051d8d0bfe138cb4a8cb7d))
* **tm:** equipment rate lines and usage sources ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T5) ([a8355a1](https://github.com/ariefsaid/PMO/commit/a8355a1598d1c914dcab4d775505a8c36b5abd9d))


### Bug Fixes

* **#1550:** keep navigation and user administration reliable (T-25) ([919a900](https://github.com/ariefsaid/PMO/commit/919a900210afeb9d5f7776eac9ae8a93b6ea6730))
* **1919:** detach org test, audit test, ledger-off test, reversed-line flag, no replay flag in 0686 ([79b9703](https://github.com/ariefsaid/PMO/commit/79b9703f1026692cfb03b2d1d36074250fd573dd))
* **1919:** e2e asserts spent and open commitment, CLI pages journals, dialog loads the project's purchases, cancelled line keeps its purchase, possibly-reversed flag, replay flag in 0689 ([d774cee](https://github.com/ariefsaid/PMO/commit/d774cee1645a50bcc9241aa3e4601df41f48b981))
* **1919:** journal list shows the remark once and fits its action ([c15ea14](https://github.com/ariefsaid/PMO/commit/c15ea1449ffe34082c1746bcd6e9be3bf8330601))
* **admin,expenses:** T-18 load and error-state fixes ([ac9f2a9](https://github.com/ariefsaid/PMO/commit/ac9f2a99b599524b4bbd9e9917d57e61cde338fc))
* **admin:** hold features console until overrides load, label credits spent as credits, clear stale grant error ([c1ce1b3](https://github.com/ariefsaid/PMO/commit/c1ce1b319f73f533df26f3c3e00199345638a5b4)), closes [#1543](https://github.com/ariefsaid/PMO/issues/1543)
* **admin:** keep agent usage cost in USD per FR-L10N-023, label column Cost (USD) ([ad6a9e5](https://github.com/ariefsaid/PMO/commit/ad6a9e5c0ce4e0f4a3e067db226e8322cfc32050))
* **agent-dispatch:** cap trigger events per tick, re-claim stale trigger claims after a lease without refiring, test audit-failure close (0683) ([065c50f](https://github.com/ariefsaid/PMO/commit/065c50f7ac39319e702bab91d5efc44a1aec8ce5))
* **agent-dispatch:** keep trigger events retryable after claim outages, judge conditions per event, close skipped audit runs ([8fc338d](https://github.com/ariefsaid/PMO/commit/8fc338d7af643a4fcbd92c9eea601f82c3abbd23))
* analytics resilience (T-28); purchase screen moves (T-43); assistant credit tests (T-10) ([c2ae70e](https://github.com/ariefsaid/PMO/commit/c2ae70e8195a6a48d9509673a4620670dfb531af))
* **analytics:** sanitise person properties ([62483f8](https://github.com/ariefsaid/PMO/commit/62483f8b5debd330872ff2d3855315c0588075c2))
* **analytics:** sanitise person properties and stored copies ([2bbf23c](https://github.com/ariefsaid/PMO/commit/2bbf23c69a1b1c9d7a7aba8b5b70ee209bf9c1d3))
* **analytics:** sanitise stored person properties ([a42dd85](https://github.com/ariefsaid/PMO/commit/a42dd851d7afdcc511025a74183f9394eeea433f))
* **analytics:** sanitise stored person properties on the deferred-load path ([ecfe138](https://github.com/ariefsaid/PMO/commit/ecfe138f013df95ad26ddeed21f5ffc1aceef4a7))
* **analytics:** tolerate blocked browser storage in demo-context setup ([489d548](https://github.com/ariefsaid/PMO/commit/489d5488cc593c3cb2576910bbb41135f1cbb7f5))
* **approvals:** coalesce bulk-approve cache refresh, refresh on all-fail, always reset running state, drop deselected failures ([4918c93](https://github.com/ariefsaid/PMO/commit/4918c9303b3e54284ec795185f27546493265866))
* **approvals:** complete queue reads and approvals page cleanup (T-18) ([ac2482c](https://github.com/ariefsaid/PMO/commit/ac2482cb447c22cfa0a273b07b504a8aae118fd8))
* **approvals:** keep failed timesheet weeks selected after bulk approve and refresh once per batch ([94d64d5](https://github.com/ariefsaid/PMO/commit/94d64d563d3d4439e0a0e82769e584b2bf8d3eb2)), closes [#1543](https://github.com/ariefsaid/PMO/issues/1543)
* **approvals:** restore Bahasa approve test, drop unused history builder and dead locale keys ([4c85a0d](https://github.com/ariefsaid/PMO/commit/4c85a0d3a58ff8e639449cadafae4bb712db83a4))
* **approvals:** surface honest read errors and scoped retry on supplementary queues ([55818d2](https://github.com/ariefsaid/PMO/commit/55818d201b07606330d935d787a02da9995c8bd7))
* **automation:** no skipped or lost trigger events; bounded ticks (T-09) ([82331e2](https://github.com/ariefsaid/PMO/commit/82331e2372116a6b1a7de0b1ceba38f9870821ae))
* **billing:** page past archived-project rows when listing incomplete work orders ([07b382a](https://github.com/ariefsaid/PMO/commit/07b382ab4d74334da4cab42630382d6cc9b16093))
* **budget:** align S7 test mocks with dev's S6 hooks and dedupe distribution mock keys ([47963c7](https://github.com/ariefsaid/PMO/commit/47963c7968d4ec1465734ef2903b70975a418273))
* **budget:** S7 review fixes ([#1472](https://github.com/ariefsaid/PMO/issues/1472)) ([93e553b](https://github.com/ariefsaid/PMO/commit/93e553ba5b36db2c1f13fd419f4ac57f290eecf4))
* **budgets:** AC-732 drops capture matrix and the Bahasa profile write; rename rollbacks to 0693/0694 ([b7e65c5](https://github.com/ariefsaid/PMO/commit/b7e65c5875d8c4a43898a6fa82223df7ef09fb04))
* **comments:** track mention spans so recipients follow edits ([8960e6c](https://github.com/ariefsaid/PMO/commit/8960e6c13c52825bd3a4a039d1309febbbbe4a22))
* **data:** chunk work-order eligibility join; restore display-order test oracles ([#1543](https://github.com/ariefsaid/PMO/issues/1543)) ([97ef1bb](https://github.com/ariefsaid/PMO/commit/97ef1bb22623225bb2d8973485582bd75638279b))
* **data:** scan approval queues and registers past the row cap ([#1543](https://github.com/ariefsaid/PMO/issues/1543), DATA-31) ([f3b73b3](https://github.com/ariefsaid/PMO/commit/f3b73b396b54f1a55c7e65e57b0d4a99c76f315f))
* **edge:** bounded webhook bodies, shared credential split, deadline covers body reads (T-22) ([f74ebdc](https://github.com/ariefsaid/PMO/commit/f74ebdc5912d7e3e2e72fd298e2844bacb2fc36e))
* **erp-connect:** file sent masters under the ERP's default group ([6022a8b](https://github.com/ariefsaid/PMO/commit/6022a8b609f1b71bbd1810b1d14532ffc1d0afc5))
* **erp:** imprest-cash-account uses shared splitAuthPair (first colon); colon-secret tests ([#1547](https://github.com/ariefsaid/PMO/issues/1547)) ([230bfa9](https://github.com/ariefsaid/PMO/commit/230bfa990ef3d6f80fe0ace39db5a0c19b672f6e))
* **erpnext:** file created parties and items under the ERP's default non-group group ([#1606](https://github.com/ariefsaid/PMO/issues/1606)) ([3e9fbae](https://github.com/ariefsaid/PMO/commit/3e9fbae2cd7144d960d6859902e6725d239ac4d6))
* **erpnext:** freed payments are not retried automatically (per-bill payment review) ([6490bef](https://github.com/ariefsaid/PMO/commit/6490befa3474a14341e4491c0644ea3b0339e496))
* **erpnext:** keep signed amount on progress-claim invoice lines ([#1820](https://github.com/ariefsaid/PMO/issues/1820)) ([472517f](https://github.com/ariefsaid/PMO/commit/472517f370621b6b1ba4756f65dbe0be5ce65515))
* **erpnext:** one in-flight payment per bill ([cb97c5a](https://github.com/ariefsaid/PMO/commit/cb97c5a1a207d65392b856db2c919023e753d10b))
* **erpnext:** progress-claim lines book the signed amount ([#1820](https://github.com/ariefsaid/PMO/issues/1820)) ([33ec203](https://github.com/ariefsaid/PMO/commit/33ec2035566453ba0d47927c7efea5a11c8f6195))
* **erpnext:** the company is chosen only through validated activation; retire the unused link branch ([1df4fb2](https://github.com/ariefsaid/PMO/commit/1df4fb2a9cec3a4791a66938b5f73ec842db6796))
* **erpnext:** unknown-precision progress lines reshape; 0 precision means unset ([#1820](https://github.com/ariefsaid/PMO/issues/1820) review) ([2dc3a63](https://github.com/ariefsaid/PMO/commit/2dc3a634a11f0a29aaa17905cfa45f455f99ba67))
* **expenses:** pause expense claim save until the project list has loaded, with retry ([d97564b](https://github.com/ariefsaid/PMO/commit/d97564b39c7398f1123f82531d73818e6ada2df2)), closes [#1543](https://github.com/ariefsaid/PMO/issues/1543)
* **expenses:** require projectLoad on the claim form and cover its modal path ([3283919](https://github.com/ariefsaid/PMO/commit/328391927ab6e2fd4533035dafe3e5d529fd0e0b))
* guarded statement query on project finance (T-12) ([9344eed](https://github.com/ariefsaid/PMO/commit/9344eedb56ac74d2570510dbb21b90d5f6b2ff11))
* **integrations:** atomic audit writes; shared handler helpers; DB-side counts (T-21) ([7079830](https://github.com/ariefsaid/PMO/commit/70798302d2fba5548032e4d79bfdf53c604d946a))
* **integrations:** connect, disconnect and company changes refresh the single-binding cache ([7e27724](https://github.com/ariefsaid/PMO/commit/7e277245564cd64ae2731612237cc41991626e2a))
* **integrations:** project bindings and outbox health counts are read to completion ([f1fcc8e](https://github.com/ariefsaid/PMO/commit/f1fcc8e7d00e837641781f2778a94b6476ec30c3))
* **integrations:** setup races, connect errors, paged binding reads (T-21) ([fb9f76a](https://github.com/ariefsaid/PMO/commit/fb9f76ae2cef5676b1befbbd4ece3adf5fc42f83))
* **integrations:** single path for linking the ERP company (T-21) ([b7adc6e](https://github.com/ariefsaid/PMO/commit/b7adc6e36f31aa216848f695f90bf3cba4f7aec4))
* **integrations:** T-21 part 2 batch; real task archive test ([#1883](https://github.com/ariefsaid/PMO/issues/1883)) ([5090940](https://github.com/ariefsaid/PMO/commit/5090940448893e2e07dd5e3422dd7160af1c82a8))
* **m365-token-custody:** point folder-write witness at isGetMethod, pin issue-path file-only guard and feature key ([80e3b2e](https://github.com/ariefsaid/PMO/commit/80e3b2e42b665f749080972dfdf44cb553380d94))
* navigation and user admin (T-25); S21 journey support split (T-39) ([dc1abfd](https://github.com/ariefsaid/PMO/commit/dc1abfdebc9707739ab866faa33c0f58ba7384e2))
* profile_prefs_unchanged requires an active member; pgTAP for peer/disabled updates; Rail case 2 asserts the hook call ([47c9b6f](https://github.com/ariefsaid/PMO/commit/47c9b6fb76a86f58203ab67d9c2522c35b05ac7c))
* **project:** only the Overview waits on the overview read; focus survives tab changes ([23617e6](https://github.com/ariefsaid/PMO/commit/23617e6340cb1a206afee6d97c3f56a3bd265ba0))
* **project:** overview read cross-org proof, per-project footer count, org-scoped fx context ([bf716b4](https://github.com/ariefsaid/PMO/commit/bf716b4308faf2a4f09239f0fee5c4bece7d3ed1))
* report count and approval queue read errors (T-12, T-18) ([c9d2cc0](https://github.com/ariefsaid/PMO/commit/c9d2cc03d8162392a50140b204b14df74fa2118d))
* shared accounting draft state; work order amount validation (T-35, T-24) ([b8cf679](https://github.com/ariefsaid/PMO/commit/b8cf679f5b352e39f0bb0013e84dfc1348e346d4))
* skip unextractable attachments; comment mention recipients (T-40, T-26) ([057a3bd](https://github.com/ariefsaid/PMO/commit/057a3bd13d1d2a7561d2629ed53cdb00d3678f37))
* **test:** assert timesheets routing against the shared ERP dispatch domain list ([fd85ebd](https://github.com/ariefsaid/PMO/commit/fd85ebd24b9c54e8fc0ba088cb9e082e117a4e36))
* **timesheets:** bulk approve keeps failed weeks and refreshes once (T-18) ([df4b874](https://github.com/ariefsaid/PMO/commit/df4b874b57bc1565de6adf4bca0f0634556495ef))
* **timesheets:** decision buttons share the committing mutation instance ([375197d](https://github.com/ariefsaid/PMO/commit/375197d9d398774aebe8f6ccba42c194aed3bedf))
* **ui:** toasts sit below an open drawer's header ([#1816](https://github.com/ariefsaid/PMO/issues/1816)) ([3e1ce45](https://github.com/ariefsaid/PMO/commit/3e1ce450b82c9c0fa713207d8d9682278fee611f))
* **ui:** toasts tuck below an open side drawer's header, not on it ([c56b397](https://github.com/ariefsaid/PMO/commit/c56b3970137279c7113f67726097acdbadd51755))
* **work-orders:** offer Confirm BAST only while the work order is Issued ([9593757](https://github.com/ariefsaid/PMO/commit/95937571e7fb0943cee66945017c978b457d7dba))
* **work-orders:** refuse allocations below the confirmed BAST quantity and withhold removal ([8706a24](https://github.com/ariefsaid/PMO/commit/8706a240c7444b8f8b5f05c11040eec1b4980d63))


### Performance

* **analytics:** load posthog-js after first render with a sanitised event buffer ([#1885](https://github.com/ariefsaid/PMO/issues/1885)) ([ee6d649](https://github.com/ariefsaid/PMO/commit/ee6d6498b0a103d651600c847924b6546a5c6732))
* **analytics:** load the SDK after first render ([#1885](https://github.com/ariefsaid/PMO/issues/1885)) ([2b10f89](https://github.com/ariefsaid/PMO/commit/2b10f89ea6264f21438371c0b389bb50e52bbdb1))
* **analytics:** route_first_data timing event, one router-level hook ([bd1761b](https://github.com/ariefsaid/PMO/commit/bd1761b3a232346f59ef49bc844d1c008c923d52))
* **analytics:** route_first_data waits for first fetch or idle, caps at 15s, reports abandoned ([6f16e50](https://github.com/ariefsaid/PMO/commit/6f16e50142928781849dcf5896fc8812c2c365ef))
* **dashboard:** lean procurements list; own timesheets/tasks only for Engineer ([e1d5413](https://github.com/ariefsaid/PMO/commit/e1d5413302d5077fdf1aa5c0ec076a6ec9493f01))
* **db:** profiles policies once per statement; set-based org features (0655) ([0c60e8a](https://github.com/ariefsaid/PMO/commit/0c60e8a82c5492b7359fec0d22b4f1c60fc17393))
* defer below-fold project reads; page the admin users directory ([aed9f03](https://github.com/ariefsaid/PMO/commit/aed9f0354844854aab9c9c6c3875b35f7355363d))
* **erpnext:** change-driven statement sync, off by default ([6fb886d](https://github.com/ariefsaid/PMO/commit/6fb886d7819533b2af59f653e0eb4b89b721e2f9))
* **lazy:** a rejected preload must not stay cached ([#1834](https://github.com/ariefsaid/PMO/issues/1834) follow-up) ([173146f](https://github.com/ariefsaid/PMO/commit/173146fc1c93021178fddbfecd12581d30ded48f))
* lighter dashboard reads (p95 at 50 users 2.5 s -&gt; 1.9 s) ([2454aa0](https://github.com/ariefsaid/PMO/commit/2454aa05030097930822288059d1c622aa779c2d))
* profiles RLS once per statement, set-based resolved_org_features, narrow shell user_views read ([45d535f](https://github.com/ariefsaid/PMO/commit/45d535f604c953ae20fd4373b1a559a22f81cca8))
* project Overview in one read (0652) ([971a7e6](https://github.com/ariefsaid/PMO/commit/971a7e6ee1b2db99b200a4da1dd36bedaa1a518c))
* **project:** one read for the Overview summaries (get_project_overview_read) ([9a6a1bc](https://github.com/ariefsaid/PMO/commit/9a6a1bc202f7f0ef50e8468a9089bbb7c9fe2111))
* **projects:** prefetch the project record on row hover, focus, and click ([558bffc](https://github.com/ariefsaid/PMO/commit/558bffc6f73c57f1068de2594282a015e1f7b08f))
* real-user page timing event (route_first_data) ([306564b](https://github.com/ariefsaid/PMO/commit/306564b8e7f56aa2bedce38b788af92d26954831))
* **routes:** load late route code in parallel with data ([#1834](https://github.com/ariefsaid/PMO/issues/1834)) ([8883c0e](https://github.com/ariefsaid/PMO/commit/8883c0e822b35862ed6c85eafd29e0cdf6322b53))
* **routes:** start a route's late code in parallel with its data ([#1834](https://github.com/ariefsaid/PMO/issues/1834)) ([cfd77bf](https://github.com/ariefsaid/PMO/commit/cfd77bf8bb3445279c38934326ce0c3796f9a0c3))


### Refactors

* **adapter-dispatch:** one list of ERP dispatch domains feeds the adapter registry, the ERP-domain gate and the target-binding guards ([6dce77d](https://github.com/ariefsaid/PMO/commit/6dce77d7c18829a49af0159dcdbf3879020355ea))
* **adapter-seam:** remove the unused read/write dispatch wrappers, keep routeWrite ([552d56a](https://github.com/ariefsaid/PMO/commit/552d56a0de25c3632c1803a1292faded5514c264))
* **admin:** share one remote-string draft hook and account option helper across accounting settings ([4466c3d](https://github.com/ariefsaid/PMO/commit/4466c3d2ba40fbd13f79803e5a57978d5e546300))
* **admin:** spend-approver add modal reuses the parent's eligible list ([fbd3e66](https://github.com/ariefsaid/PMO/commit/fbd3e6633d26baec8a34d1cca62755baa71caaa5))
* **agent-chat:** finish deputy re-auth consolidation; review minors ([561dc10](https://github.com/ariefsaid/PMO/commit/561dc1094a6608d105a2c9b7c9417089ea6288ea))
* **agent-chat:** trim unused wiring around approvals and continuations ([1c025ff](https://github.com/ariefsaid/PMO/commit/1c025ff6594e25ecfedfb7edde93c1c69b5da893))
* **agent:** split assistant handler and panel hook (T-45) ([6cb6ba6](https://github.com/ariefsaid/PMO/commit/6cb6ba66d055ca699a7e80ab272ca5920a3eb57f))
* **analytics:** drop the two unread fields from AnalyticsConfig ([e1220f7](https://github.com/ariefsaid/PMO/commit/e1220f70d2be5a3f696d113b5df506ba77ee3f92))
* **analytics:** drop the unused boolean opt-out facade ([e1a4579](https://github.com/ariefsaid/PMO/commit/e1a4579193d679c09728cf281494790ef2ddb060))
* **analytics:** inline event payloads into facade capture calls ([b837fa9](https://github.com/ariefsaid/PMO/commit/b837fa9c9783b3f3a57a506feed258c3484e1a94))
* **approvals:** extract timesheet sections and queue rendering from the approvals page ([38aa361](https://github.com/ariefsaid/PMO/commit/38aa361382c660511dc56d486f2413fb0e27a80d))
* **approvals:** remove the unused procurement approval section and row wrapper ([2b567b5](https://github.com/ariefsaid/PMO/commit/2b567b5dbb0bf51245856eba8e59de7f379947fb))
* **assistant:** drop dead panel and shell surfaces ([d63bb81](https://github.com/ariefsaid/PMO/commit/d63bb81896f264b2581342574619ca1bf2e00631))
* **assistant:** extract pure seams from the panel orchestration hook ([e1d57f7](https://github.com/ariefsaid/PMO/commit/e1d57f7884b38608d1be0b815edeb50cc34b7a21))
* **integrations:** health read and panel move out of IntegrationsView ([0cc1c71](https://github.com/ariefsaid/PMO/commit/0cc1c71aed01d41058767dee47affc7915977778))
* **m365-token-custody:** share item metadata decoder and root check, require service-backed membership, drop unused interfaces and forwarding module ([a96e0d7](https://github.com/ariefsaid/PMO/commit/a96e0d7a55c649f5d39d1efe11f7c9ad0b2a7ad6))
* **m365:** drop unread M365ErrorBody.message ([ea5ed8a](https://github.com/ariefsaid/PMO/commit/ea5ed8a6c678668561865ef9bb21a2b23ad634f4))
* **m365:** frontend dedupe (T-23) ([bc72f83](https://github.com/ariefsaid/PMO/commit/bc72f83be91274f975249dc9a2f0348105997751))
* **m365:** share one classified-throw helper, drop forwarding exports and unused props, share document reference columns ([c8083d1](https://github.com/ariefsaid/PMO/commit/c8083d144becbaeba8473690283deed0433e8b11))
* **m365:** simpler custody and entitlement gate (T-23) ([3f83c31](https://github.com/ariefsaid/PMO/commit/3f83c3145fd7b6eeb7d45ba611a6a22de8749816))
* **procurement:** drop redundant form reset, line validators, alias and returned budget flag ([2242b26](https://github.com/ariefsaid/PMO/commit/2242b260dfc2df45f6d7800f1cf70769492757e2))
* **procurement:** move payment bill selection into PaymentCaptureFields ([f245760](https://github.com/ariefsaid/PMO/commit/f24576046143076066408f9182219c940833c3b0))
* **procurement:** move record-capture kind config into its own module ([4b1bb7e](https://github.com/ariefsaid/PMO/commit/4b1bb7e4c9dcf63baf6123fa25ea65dd1b918fd7))
* **procurement:** move tab projections and the items, quotes and details panels out of the record page ([de11181](https://github.com/ariefsaid/PMO/commit/de1118135d36b8c2ad6127847448a3c82d3e70aa))
* **procurement:** move the sign-off gate message beside the stage actions ([39e6748](https://github.com/ariefsaid/PMO/commit/39e67483b5843334be9d4c96d400b7649597b5db))
* **procurement:** move the stage-then-commit decision workflow into useProcurementDecision ([c50794b](https://github.com/ariefsaid/PMO/commit/c50794bad7000e28d57883652da9d95ef855ed5b))
* **procurement:** move vendor-invoice tax capture into its own hook and fields ([60bbbaf](https://github.com/ariefsaid/PMO/commit/60bbbaf6838a2a7d57d912322b0c0b7cae56a277))
* **procurement:** move withholding-slip panels and focus return out of the record page ([1e57ff0](https://github.com/ariefsaid/PMO/commit/1e57ff0ff18fc44d4d4c55b825893eea6f4a5377))
* **procurement:** purchase screen cleanup, part 1 (T-43) ([55fbf8d](https://github.com/ariefsaid/PMO/commit/55fbf8da1a24e129e43ead4bb07a590374587e38))
* **procurement:** purchase screen cleanup, part 2 (T-43) ([7499741](https://github.com/ariefsaid/PMO/commit/74997412e7ab2382d5f721b24fdb374162f0ebd8))
* **procurement:** simplify list export columns, row link handler, required action facts ([9fda277](https://github.com/ariefsaid/PMO/commit/9fda277bf758472f65f9416117eb636ba68156ae))
* **shell:** route notification bell reads through a notification repository ([7687ae5](https://github.com/ariefsaid/PMO/commit/7687ae5038fcdf2b4040e2280ce6e755854762c1))
* **statements:** extract local guarded statement query helper ([8ab9b35](https://github.com/ariefsaid/PMO/commit/8ab9b35f6a2a7ba37c6a57a66b1819927ece3314)), closes [#1540](https://github.com/ariefsaid/PMO/issues/1540)
* **timesheets:** one approval controller, confirm and button set for queue and preview ([f22e263](https://github.com/ariefsaid/PMO/commit/f22e26373112682f414f3db8b656c1d9a7d2c79e))
* **work-orders:** share value and tax validation between create form and set-value dialog ([#1549](https://github.com/ariefsaid/PMO/issues/1549)) ([571e450](https://github.com/ariefsaid/PMO/commit/571e450f54b19d36e92d3d83c3dde68eca3bf2d6))

## [0.32.0](https://github.com/ariefsaid/PMO/compare/v0.31.0...v0.32.0) (2026-11-05)


### Features

* **integrations:** ERP setup screen with per-row review ([#1605](https://github.com/ariefsaid/PMO/issues/1605)) ([b641b09](https://github.com/ariefsaid/PMO/commit/b641b0991d06cc7c7a5701c4c5b0cea10e034807))
* **odoo:** client invoice and receipt screens ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C8) ([c82db5a](https://github.com/ariefsaid/PMO/commit/c82db5a05ebdac46bf8fdb7611db5f931ed91331))
* **odoo:** client-invoice contract suite and served proof (C9, [#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([4a6dd3d](https://github.com/ariefsaid/PMO/commit/4a6dd3dec3604894f9ad8ed4fbe6028443fb4884))
* **odoo:** complete purchase-to-payment P9 ([2167130](https://github.com/ariefsaid/PMO/commit/2167130d5b8d69d81defcb5a98ad6bb1ee325b4c))
* **odoo:** purchase cutover and activation proof (P9, [#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([2a7ff87](https://github.com/ariefsaid/PMO/commit/2a7ff878d55219aa804ae180ecff45c3d45be8fb))
* **odoo:** recover in-flight procurement writes in the background ([#1505](https://github.com/ariefsaid/PMO/issues/1505) AC-OPP-062) ([dcd9ffa](https://github.com/ariefsaid/PMO/commit/dcd9ffa2c1685ce49e176b02d6e300a415535154))
* **procurement:** line-level goods receipts under procurement_full ([#1783](https://github.com/ariefsaid/PMO/issues/1783) item 1) ([7dd0769](https://github.com/ariefsaid/PMO/commit/7dd07699aced2c8b6aa17a2c9ea9a8ae20f1b9d4))
* **procurement:** line-level receipt writes require procurement_full ([#1783](https://github.com/ariefsaid/PMO/issues/1783)) ([7018071](https://github.com/ariefsaid/PMO/commit/701807192088e847418fa5462f948904f83dc0f7))
* **sales:** pipeline stage order and Go/Get ([#1793](https://github.com/ariefsaid/PMO/issues/1793), [#1796](https://github.com/ariefsaid/PMO/issues/1796)) ([0526e1f](https://github.com/ariefsaid/PMO/commit/0526e1fdef2ac161eafd5a1b09607d3657186556))
* **tm:** time-and-materials claim source details (D1, [#1514](https://github.com/ariefsaid/PMO/issues/1514)) ([c351b94](https://github.com/ariefsaid/PMO/commit/c351b94667415fc19892b260a343b3c6d123025e))


### Bug Fixes

* **analytics:** sanitize nested URL properties before send ([e8fa94e](https://github.com/ariefsaid/PMO/commit/e8fa94e0cb9b8405509d3fb0f5bb7f991324d7a1))
* **budget,procurement:** read the whole category map and linked ERP document list ([6e03778](https://github.com/ariefsaid/PMO/commit/6e03778ace46db82745b83ab392a8a1fb14557d6)), closes [#1540](https://github.com/ariefsaid/PMO/issues/1540)
* **budget:** whole-project range units and activation ([#1472](https://github.com/ariefsaid/PMO/issues/1472) S4/S5) ([80e93d3](https://github.com/ariefsaid/PMO/commit/80e93d36f9b87d77eea1949fd95934fc6b4336df))
* clear dev CI regressions ([f0db52c](https://github.com/ariefsaid/PMO/commit/f0db52c133c2f012cc9cdbb987d687e8d5e5b5b0))
* **client:** bound session cache freshness and scope plan keys ([a1df6cd](https://github.com/ariefsaid/PMO/commit/a1df6cdcc3051ad387bc1362f6dd00c542c0736b))
* **db:** renumber TM claim source migration to 0588 ([#1514](https://github.com/ariefsaid/PMO/issues/1514) D1) ([d4e450c](https://github.com/ariefsaid/PMO/commit/d4e450c9ff6c0216bc7fc8c695efaaa095d3063f))
* dev CI red (tier branches behind the seam, budget paging fixture, empty interface) ([1535e7e](https://github.com/ariefsaid/PMO/commit/1535e7e483f9cf90d7ae5ceca30adb6da5a0b296))
* don't wait for ERP when creating projects ([050266b](https://github.com/ariefsaid/PMO/commit/050266b9b1f571b5773e06d1ddf8a4491c520521))
* **e2e:** each phase keeps its own failure artifacts ([a40f7a6](https://github.com/ariefsaid/PMO/commit/a40f7a64b823afc240290ee88823dbbee3808cf7))
* **e2e:** give each Playwright phase its own output dir ([#1870](https://github.com/ariefsaid/PMO/issues/1870)) ([3008669](https://github.com/ariefsaid/PMO/commit/3008669211ecd55fece7204c0b007be9157dd1cf))
* **erpnext:** accept canonical UUID shape in statement report refresh ([#1495](https://github.com/ariefsaid/PMO/issues/1495)) ([364d12e](https://github.com/ariefsaid/PMO/commit/364d12e0448a18e4aab471c799090af8d6ec778a))
* **features:** a failed background refetch no longer unmounts a gated page ([423cef1](https://github.com/ariefsaid/PMO/commit/423cef12c266b627cdcd05aadfdcbebd6ffdb79c))
* **features:** keep the resolved answer when a background refetch fails ([f463b7f](https://github.com/ariefsaid/PMO/commit/f463b7f3dbedd82c149d3d443aa3cd128b2a98e4))
* **finance:** count receivables with unknown amounts honestly ([#1475](https://github.com/ariefsaid/PMO/issues/1475)) ([9f32d6e](https://github.com/ariefsaid/PMO/commit/9f32d6e7a4500505902ad7d774dde1d3c8c63b54))
* **odoo:** align P9 contract review ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([569c5ae](https://github.com/ariefsaid/PMO/commit/569c5aef48787fd7c06a6067a527ea147327fc36))
* **odoo:** close C9 review findings ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C9 review) ([1c574db](https://github.com/ariefsaid/PMO/commit/1c574dbceb1753d672e60671e500237d257b4324))
* **odoo:** close recovery budget and anchor gaps ([#1505](https://github.com/ariefsaid/PMO/issues/1505) AC-OPP-062 review) ([143e3a8](https://github.com/ariefsaid/PMO/commit/143e3a8be65877ec9cf06c9cf4cc5903bec678c0))
* **odoo:** keep procurement tier checks in the Odoo seam ([#1505](https://github.com/ariefsaid/PMO/issues/1505) AC-OPP-062) ([a06c11c](https://github.com/ariefsaid/PMO/commit/a06c11c582a1928c6ab32a0206fa290487faa58d))
* **odoo:** reconcile P9 C9 contracts ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([5d12ce9](https://github.com/ariefsaid/PMO/commit/5d12ce9856b34710958594925a7ad5da0450f83c))
* **odoo:** recovery budget is charged after claim and refunded ([#1505](https://github.com/ariefsaid/PMO/issues/1505) AC-OPP-062) ([195b446](https://github.com/ariefsaid/PMO/commit/195b4466084360a8c4904831df1eba4a6cbdcbd4))
* **odoo:** type production contract harness ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([d7248c2](https://github.com/ariefsaid/PMO/commit/d7248c28bc71ef6f65d3a5d61f54524df469b4b0))
* **procurement:** end receipt capture after success ([9711cf2](https://github.com/ariefsaid/PMO/commit/9711cf2ae961a31cb3fb1ddf7d0d79ee7f6a57ee))
* **procurement:** persist purchase orders from capture form ([9858612](https://github.com/ariefsaid/PMO/commit/98586123573eaf6816f26fd99059b5a4e032dcba))
* **projects:** create no longer waits for the ERP sync ([2f14a30](https://github.com/ariefsaid/PMO/commit/2f14a30fdfca1c3fa9b042e147b3041a66176ea2))
* **revenue:** propagate unknown outstanding balance count in getRevenueByProject ([#1475](https://github.com/ariefsaid/PMO/issues/1475)) ([82d8e6a](https://github.com/ariefsaid/PMO/commit/82d8e6a8ef07fc80997307e227957a029a281ddb))
* v0.31 hotfixes (analytics URL sanitize; stage redate CLI [#1835](https://github.com/ariefsaid/PMO/issues/1835)) ([cfc1177](https://github.com/ariefsaid/PMO/commit/cfc1177d09b9d420803e4e052bbae4e7634dd685))


### Performance

* **budget:** read budget versions in one aggregate RPC ([f1aa07a](https://github.com/ariefsaid/PMO/commit/f1aa07aa292c45700a670b654bf0a5c244625a38))
* **budget:** single RPC read for project budget version page (#Q12) ([5a7372a](https://github.com/ariefsaid/PMO/commit/5a7372a5a3911d3e528c130d1401b332df9c6dbb))
* **client:** cache stable queries and batch reads ([5741c73](https://github.com/ariefsaid/PMO/commit/5741c7379c0a988dd7ea84ef1f0a5414a0509da1))
* **client:** share session reads, batch dashboard lookups, split analytics out of the list chunk ([bbb3953](https://github.com/ariefsaid/PMO/commit/bbb39533b7b85fcb3171fa5b4148fec7b1ebe9fa))


### Refactors

* **data:** complete linked-record reads and remove dead exports (T12 batch) ([a708332](https://github.com/ariefsaid/PMO/commit/a7083324d4af62bb1be072159f19def8e254669b))
* **financialStatements:** remove unused native report exports ([93e11f8](https://github.com/ariefsaid/PMO/commit/93e11f899d278f988372d172592c25a028da8770)), closes [#1540](https://github.com/ariefsaid/PMO/issues/1540)
* **tables:** shared DataTable renderers ([#1723](https://github.com/ariefsaid/PMO/issues/1723)) ([3274009](https://github.com/ariefsaid/PMO/commit/3274009a93018f8c7e7b7d87a071ae413d2e27e4))
* **ui:** split DataTable desktop and mobile render branches ([#1723](https://github.com/ariefsaid/PMO/issues/1723)) ([8ea7d8c](https://github.com/ariefsaid/PMO/commit/8ea7d8cd80f458eeceba4889b4d79dfd9277ad10))
* **ui:** split DataTable desktop and mobile render branches ([#1723](https://github.com/ariefsaid/PMO/issues/1723)) ([06069dc](https://github.com/ariefsaid/PMO/commit/06069dc20f097699c2f40cfa59266207f6200bb3))

## [0.31.0](https://github.com/ariefsaid/PMO/compare/v0.30.0...v0.31.0) (2026-11-04)


### Features

* add versioned contract rate card ([acd9486](https://github.com/ariefsaid/PMO/commit/acd948694d2351da93d04ad7fa978812b091c308))
* **agent-chat:** assistant tools follow the org plan switches; missing-tool signal; plan group property (S4) ([01266a8](https://github.com/ariefsaid/PMO/commit/01266a8a2845dae3112b6641c685dd28bbd598da))
* **agent:** assistant reads warehouse stock ([#1721](https://github.com/ariefsaid/PMO/issues/1721)) ([8ae09a3](https://github.com/ariefsaid/PMO/commit/8ae09a3d694c3733d8593b26101e9c7854d9a3b4))
* **approvals:** bulk-approve purchases; rejection needs a comment ([#1578](https://github.com/ariefsaid/PMO/issues/1578)) ([99f88d1](https://github.com/ariefsaid/PMO/commit/99f88d177d78f39207b71c93430574cdafc74d9d))
* **approvals:** bulk-approve purchases; rejection requires a comment ([#1578](https://github.com/ariefsaid/PMO/issues/1578)) ([282f153](https://github.com/ariefsaid/PMO/commit/282f153c223a3a8af4145a0ee50af16729ecc2fa))
* **budget:** add exact paste row parser and preview ([68a0571](https://github.com/ariefsaid/PMO/commit/68a05710fa2259d8135f1138e7b8426a2fb26c87))
* **budget:** paste-rows parser and yearly distribution; finish the repository contract split ([#1473](https://github.com/ariefsaid/PMO/issues/1473) A, [#1472](https://github.com/ariefsaid/PMO/issues/1472) S1–2, T-29) ([4ed533a](https://github.com/ariefsaid/PMO/commit/4ed533aefe9284c8cc7e575ee55414958a56e18c))
* **budget:** show PMO paid actuals by category ([2c2b3bb](https://github.com/ariefsaid/PMO/commit/2c2b3bb91d2a3bc28c822906c34636f497b2c2fd))
* **budgets:** whole-project budget comparison RPC ([#1472](https://github.com/ariefsaid/PMO/issues/1472) C1) ([5012f7b](https://github.com/ariefsaid/PMO/commit/5012f7bef4711fd14b29146463c278a3afa4e42c))
* **budgets:** whole-project budgets S3: storage, distribution RPC, roles ([#1472](https://github.com/ariefsaid/PMO/issues/1472)) ([3de3e4f](https://github.com/ariefsaid/PMO/commit/3de3e4f2278265674c316f2067b2dfb44721dda3))
* **entitlements:** plans and feature-switch resolution core ([#1718](https://github.com/ariefsaid/PMO/issues/1718) S1) ([1291c0a](https://github.com/ariefsaid/PMO/commit/1291c0af054c5ec93b0530e5b7c7dc34a3392577))
* **equipment:** usage week, approvals, assets, costing screens and project panel ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S5-S7) ([da82bd5](https://github.com/ariefsaid/PMO/commit/da82bd5bbcdf4c0f8da7b601f56eee0bb6779978))
* **erp-connect:** pair PMO invoices with ERP invoices (eca-5) ([6d7b9a1](https://github.com/ariefsaid/PMO/commit/6d7b9a1b2dff4ef032fd5845a1b69327aebee405))
* **erp:** send PMO clients, vendors, projects and items to an empty ERP ([#1606](https://github.com/ariefsaid/PMO/issues/1606)) ([6e219dc](https://github.com/ariefsaid/PMO/commit/6e219dc0f8e55d34be97105f30cf7a9b2f0ed045))
* **odoo:** [#1506](https://github.com/ariefsaid/PMO/issues/1506) C1 contract-first revenue pure parts, fake Odoo customer invoices and payments, harness ([63cf48a](https://github.com/ariefsaid/PMO/commit/63cf48a68df8eea2c97b957bd62c35e483165fd3))
* **odoo:** add customer receipt push ([03a99d0](https://github.com/ariefsaid/PMO/commit/03a99d02a892aa61132dca9fea526cce44f6211f))
* **odoo:** add purchase contract foundation and update pending assertions ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([d3a4256](https://github.com/ariefsaid/PMO/commit/d3a4256a8e589decb2cf7d577ee37ab35e909eee))
* **odoo:** add revenue feed and census ([3a079fc](https://github.com/ariefsaid/PMO/commit/3a079fc9a86b13ccff25b4ec4638807c95bef07e))
* **odoo:** C2 revenue enablement, gates and outbox wiring ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([9bdfb21](https://github.com/ariefsaid/PMO/commit/9bdfb214a4ceb18c5cae7afd8fd2748d45ee2157))
* **odoo:** C3 invoice push as PMO draft + approval, read-back, bed proof ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([9e8e0de](https://github.com/ariefsaid/PMO/commit/9e8e0de0b4e4137ea33423d333d04a54d79894ae))
* **odoo:** C3 Odoo invoice push: PMO draft, one approved create+post ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([561cf1c](https://github.com/ariefsaid/PMO/commit/561cf1cab2803700cd7b896495956668417d8c53))
* **odoo:** C4 Odoo progress-claim invoices ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([3da0129](https://github.com/ariefsaid/PMO/commit/3da01299a9618c605fdbebba5679013d084d54c1))
* **odoo:** C4b signed T&M claims invoiced on Odoo ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([ecc902e](https://github.com/ariefsaid/PMO/commit/ecc902ee0d16a4e878399e6ce4e81fdfe6c5c0ef))
* **odoo:** C5 Odoo receipts on client invoices ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([e1915f8](https://github.com/ariefsaid/PMO/commit/e1915f88a088d6654b9f41d77249930e82da4279))
* **odoo:** C6 Odoo payment feed for client invoices ([#1506](https://github.com/ariefsaid/PMO/issues/1506)) ([90ebb5c](https://github.com/ariefsaid/PMO/commit/90ebb5c244f1c300689c63d70a3ddb7a8adf7504))
* **odoo:** employ revenue under Odoo, revenue gates and money-outbox wiring, PPN output tax rule ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C2) ([db0f182](https://github.com/ariefsaid/PMO/commit/db0f182880556c83b496a7f9540875c16f7b8a8a))
* **odoo:** goods receipt push, partial/backorder, over-receipt guard, persisted plan and idempotent recovery ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P4) ([278b8b9](https://github.com/ariefsaid/PMO/commit/278b8b943d1cc70250cd7579ac61acf0dff8dcb1))
* **odoo:** honour an operator's adopt or absent on a held payment, bed test, plan notes ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P6) ([8ad0041](https://github.com/ariefsaid/PMO/commit/8ad004164ad3aa228ed568818f7e4b428c046a36))
* **odoo:** inbound purchase feed, status reconciliation and link-existing ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P7) ([b9d44e5](https://github.com/ariefsaid/PMO/commit/b9d44e5ad976fc860e016ab71ba966f680ea462d))
* **odoo:** inbound purchase feed, status reconciliation, link-existing and census ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P7) ([248b304](https://github.com/ariefsaid/PMO/commit/248b3040fb9da0738c78b6de3999b0935b45e4b9))
* **odoo:** invoice signed time-and-materials claims ([1765306](https://github.com/ariefsaid/PMO/commit/1765306dac1d1987b3d31142b29e73d282c91a45))
* **odoo:** model-qualified external id for the bill, per-model ids in the fake ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P5) ([8472e28](https://github.com/ariefsaid/PMO/commit/8472e28f66193f21df6927b1adace8ec5039fb2f))
* **odoo:** P2 procurement enablement, tier-agnostic dispatch gates, outbox wiring ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([6083400](https://github.com/ariefsaid/PMO/commit/6083400b3011be1def287c33d000e0acff73eb18))
* **odoo:** purchase order push and revise, project gate, order recovery composite ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P3) ([ec10113](https://github.com/ariefsaid/PMO/commit/ec10113d5866f39ebe8374fd6f318116a24c9b03))
* **odoo:** purchase screens, outcome states, held-payment decision, tax and journal pickers ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P8) ([7cb8d52](https://github.com/ariefsaid/PMO/commit/7cb8d52043c024cd7613d01d1feb2d896d8d7d94))
* **odoo:** purchase-to-payment enablement and tier-agnostic money gates ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P2) ([b4f7458](https://github.com/ariefsaid/PMO/commit/b4f7458ea038836c5e72ac95c4e9be336d176c9f))
* **odoo:** push and revise purchase orders ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P3) ([7a5a389](https://github.com/ariefsaid/PMO/commit/7a5a389912adfbc2653fd4ea750a61018d5c5b6a))
* **odoo:** push goods receipts to Odoo ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P4) ([abfd61d](https://github.com/ariefsaid/PMO/commit/abfd61d0f9022fed41467364ac696d9791f00898))
* **odoo:** push vendor bills and withholding to Odoo ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P5) ([7f1f34a](https://github.com/ariefsaid/PMO/commit/7f1f34a90a1c48db179222f4bde527de5a27d214))
* **odoo:** support billing claims ([e0c7796](https://github.com/ariefsaid/PMO/commit/e0c77964ca6275bdbd2a2df16391490f2d6d914a))
* **odoo:** vendor bill and withholding push, explicit taxes, money read-back ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P5) ([b462e2b](https://github.com/ariefsaid/PMO/commit/b462e2b343da009acfe92f88581ec17c64d1538d))
* **odoo:** vendor payment push, payer rule, held-payment resolution ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P6) ([4e6c30f](https://github.com/ariefsaid/PMO/commit/4e6c30f21bd4947f4c57a46694c1ba040b3c17b8))
* **odoo:** vendor payments, and Odoo money commands go through the money outbox ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P6) ([dd3a638](https://github.com/ariefsaid/PMO/commit/dd3a63816419cacd3d66e5a4347dfa591ef5c1fe))
* **plans-s6:** module-completeness gate wired into check:guards ([0f315e1](https://github.com/ariefsaid/PMO/commit/0f315e19b1414aa06912f8b15643c7c735a9324c))
* **plans:** complete S1 follow-ups — FE core mirror, 0533 rollback, denominator ([#1734](https://github.com/ariefsaid/PMO/issues/1734)) ([4be8c31](https://github.com/ariefsaid/PMO/commit/4be8c31cc1b0260990c9c1b3f95bc24c912a7e3b))
* **plans:** S3 — resolved-set FE, Operator console and read-only Your plan ([8323792](https://github.com/ariefsaid/PMO/commit/8323792cfb5efd4b6ef24d921575782f8febb787))
* **plans:** S3 operator console, Admin "Your plan", FE reads the plan resolver ([#1718](https://github.com/ariefsaid/PMO/issues/1718)) ([ee3e3fa](https://github.com/ariefsaid/PMO/commit/ee3e3fa10596c9b003e8e681d2ca451137919684))
* **plans:** S4 the assistant follows feature switches ([#1718](https://github.com/ariefsaid/PMO/issues/1718)) ([14181bc](https://github.com/ariefsaid/PMO/commit/14181bc978d75ea00ae53280a017f3787e34b3aa))
* **plans:** S5 limits — seats, active projects, monthly AI allowance (0535) ([c2e66d6](https://github.com/ariefsaid/PMO/commit/c2e66d65219002b052178cf8f30391c94217ad86))
* **plans:** S5 plan limits: seats, active projects, monthly AI allowance ([#1718](https://github.com/ariefsaid/PMO/issues/1718)) ([444956b](https://github.com/ariefsaid/PMO/commit/444956b6647837abf5418a6499a9334829c60e29))
* **sales:** add all pipeline table scope ([2810464](https://github.com/ariefsaid/PMO/commit/2810464eb10fa3aa43ef344e4c032182919a93ea))
* **t&m:** claim assembly from live time sources ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T2) ([867d3fe](https://github.com/ariefsaid/PMO/commit/867d3fef9ee5fedbcb15728182f31c7ec4e58904))
* **t&m:** contract rate card ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T1) ([b764020](https://github.com/ariefsaid/PMO/commit/b76402094d41a2955a76f85efc5c761ea9fbc1ae))
* **tm:** add billing screens ([c3c1e23](https://github.com/ariefsaid/PMO/commit/c3c1e23c6afa4bf28e2c35f6600a1e3da977b1c3))
* **tm:** assemble draft time-and-materials claims from approved timesheet hours ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T2) ([168036d](https://github.com/ariefsaid/PMO/commit/168036d61b8993fed113219dfc117058257adfab))
* **tm:** claim list and preview reads, API-client tiers ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T4) ([89c6b76](https://github.com/ariefsaid/PMO/commit/89c6b762208fd6bb87067dcedccd2ebef803a611))
* **tm:** client sign-off and the invoice bridge for time-and-materials claims ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T3) ([4164f3b](https://github.com/ariefsaid/PMO/commit/4164f3bc5d2966aa6b341f43fe992f4d09f3f434))
* **tm:** client sign-off for time-and-materials claims ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T3) ([a3e54d3](https://github.com/ariefsaid/PMO/commit/a3e54d3bb885ca8ec388c1150ac649ab9b1ab394))
* **tm:** data layer for time-and-materials claims ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T7) ([7de9cbd](https://github.com/ariefsaid/PMO/commit/7de9cbdcd2ca72c865df541b7ec7357b04262a00))
* **tm:** map rate lines to sales items ([#1802](https://github.com/ariefsaid/PMO/issues/1802)) ([d8f4ff5](https://github.com/ariefsaid/PMO/commit/d8f4ff588cf8068ec4a30fdee40eb94621787027))
* **tm:** map T&M rate lines to ERPNext sales items ([#1802](https://github.com/ariefsaid/PMO/issues/1802)) ([23b9d9f](https://github.com/ariefsaid/PMO/commit/23b9d9fe0acb0ea0065d873f650a506008cbddd0))
* **tm:** T6 send signed T&M claim lines to the ERPNext invoice unchanged ([#1514](https://github.com/ariefsaid/PMO/issues/1514)) ([3ad1530](https://github.com/ariefsaid/PMO/commit/3ad1530e4354ea362b5dfd48dc5d8c567c60c60b))
* **tm:** time-and-materials reads and API-client read tiers ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T4) ([5027410](https://github.com/ariefsaid/PMO/commit/50274105c3af1049f150f3572a8e215596e52b47))
* **tm:** time-and-materials screens ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T8) ([9454769](https://github.com/ariefsaid/PMO/commit/945476970b385a30c740654b59b6b70b0c7604f0))
* **ui:** add total count and 'Showing x of y' chip to ListPage ([736f9d6](https://github.com/ariefsaid/PMO/commit/736f9d6d31a630a32a47ee1d107ad2dd9a5680a0))
* **ui:** subcontract variations, link and journey ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S7b) ([01a774c](https://github.com/ariefsaid/PMO/commit/01a774c5e6f857859ec94fe5f554b959fdcdfe2c))


### Bug Fixes

* **#1774:** page the six at-risk list reads past the 1,000-row cap ([c042ee8](https://github.com/ariefsaid/PMO/commit/c042ee838f8b8aeb8f9fdf3d523cb8f647800d39))
* avoid duplicate drawer subtitle content ([7095eec](https://github.com/ariefsaid/PMO/commit/7095eecbd8ff5761182e240a04a76d00c0a309c8))
* **budget:** PMO commitments count only the unpaid remainder; paid spend shows in unbudgeted categories ([#1530](https://github.com/ariefsaid/PMO/issues/1530)) ([60fe6f3](https://github.com/ariefsaid/PMO/commit/60fe6f302e315f13b996719fc1ce933d5a50f84e))
* **budget:** safely cancel legacy archive targets ([#1462](https://github.com/ariefsaid/PMO/issues/1462)) ([a9be208](https://github.com/ariefsaid/PMO/commit/a9be2086662de69dd9031ce5b196b436b08dccce))
* **budgets:** cancel an older-shape budget push on archive ([#1462](https://github.com/ariefsaid/PMO/issues/1462), v15 half) ([9bd2927](https://github.com/ariefsaid/PMO/commit/9bd29278c52b1415a9858a3d4397d433af5c08be))
* **budget:** show spending for organizations without an accounting system ([#1530](https://github.com/ariefsaid/PMO/issues/1530)) ([ae0e5d2](https://github.com/ariefsaid/PMO/commit/ae0e5d24b26282b5deb98d72d02eebf3e946b90c))
* clarify assistant and connection language (T-38) ([0f46431](https://github.com/ariefsaid/PMO/commit/0f464318774c43eeefa0ceacf76581f631047681))
* **e2e:** release v0.31.0 round-3 layout fixes ([237623d](https://github.com/ariefsaid/PMO/commit/237623d84bb6042bba1ae0b0bff05103f02c3cc9))
* **e2e:** release v0.31.0 serial-lane fixes ([a355051](https://github.com/ariefsaid/PMO/commit/a355051c13642286dcb9ca3115f38a1a39242c25))
* **eca-5:** pair only on equal tax, page the pairing reads, show failed reads ([#1602](https://github.com/ariefsaid/PMO/issues/1602)) ([eb0d7a6](https://github.com/ariefsaid/PMO/commit/eb0d7a6245966af418e248782f9ed1df1b9513f4))
* **edge:** tighten feature hold proofs ([36613fa](https://github.com/ariefsaid/PMO/commit/36613facbf2432188a081fde30fbff6b101a0c3a))
* **equipment:** actual-cost by units sends the usage unit ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S6) ([6d1104a](https://github.com/ariefsaid/PMO/commit/6d1104a64aefdb10d4583676a4474964b9a116f1))
* **equipment:** compact week grid and plain count labels ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S6) ([179ee3c](https://github.com/ariefsaid/PMO/commit/179ee3c1e1b54203b125cad4ff02a1bf93ec9c0b))
* **equipment:** size the week grid columns so totals and status stay in view ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S6) ([b1c7831](https://github.com/ariefsaid/PMO/commit/b1c783127ab360ec96bfe9245628db79677f5099))
* **fe:** use organization timezone business day for dates ([163bfb6](https://github.com/ariefsaid/PMO/commit/163bfb6e5bc95f27b87c951d1882c7443def13c9))
* **flags:** repair S3 shell CI fixtures ([074ede3](https://github.com/ariefsaid/PMO/commit/074ede3eecc1e836c596e34eadeb5e254417923c))
* **flags:** repair S4 shell CI fixtures ([8ede546](https://github.com/ariefsaid/PMO/commit/8ede546f7276ca7fb0181838cf97c8bfd8ccb7b8))
* harden S5 plan limit handling ([a5fa0c9](https://github.com/ariefsaid/PMO/commit/a5fa0c958861c4ca41e9f9e8a45de36601ed2090))
* **i18n:** clarify financial and purchasing language (T-36, [#1568](https://github.com/ariefsaid/PMO/issues/1568)) ([795e4ba](https://github.com/ariefsaid/PMO/commit/795e4ba423c0ab6397d5253029924a4f69df9f7f))
* **i18n:** clarify supplier invoice number copy ([#1463](https://github.com/ariefsaid/PMO/issues/1463)) ([7c3cf4e](https://github.com/ariefsaid/PMO/commit/7c3cf4e642382da48189cc5ee9f43ad6ccedb845))
* in-app finance links open the /finance routes directly ([#1524](https://github.com/ariefsaid/PMO/issues/1524)) ([c44a664](https://github.com/ariefsaid/PMO/commit/c44a664426480569e395beda46f09c180ce27486))
* keep update password proof accessible ([8b00d69](https://github.com/ariefsaid/PMO/commit/8b00d69ae10a25973830ea990511e1db61a4d965))
* **meetings:** resolve ticket 1542 findings ([21021e5](https://github.com/ariefsaid/PMO/commit/21021e5c7ec01967dd8963716a1c459b86b904b6))
* **odoo:** a payment retry is a replay at selection, one in-flight payment per bill, bed count assertion ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P6 review) ([1ed5f2b](https://github.com/ariefsaid/PMO/commit/1ed5f2bdc048c26d0fe74a0564dd3b8fe6bbcbf6))
* **odoo:** align Odoo rounding and T&M guards ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C4b review) ([145e632](https://github.com/ariefsaid/PMO/commit/145e632e4fee85d18cb4321b8696544b891899fe))
* **odoo:** bill composite only in recovery and never adopts, refuse entered taxes, fail on order-line read ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P5 review) ([b0ca3c4](https://github.com/ariefsaid/PMO/commit/b0ca3c414b171e52499df152770b5e6d53add75b))
* **odoo:** bill progress-claim lines at the signed amount ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C4 review) ([82f78e6](https://github.com/ariefsaid/PMO/commit/82f78e60c16aefd7c9be0d60dcbd085f52ba8851))
* **odoo:** budget recovery and preserve receipt gross ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C6 on C5) ([46f5d42](https://github.com/ariefsaid/PMO/commit/46f5d42f43186481e3c1c8005308bcd11edb991f))
* **odoo:** hold on look-alike orders, guard stale revisions, one line identity, company currency ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P3 review) ([6aed2d6](https://github.com/ariefsaid/PMO/commit/6aed2d642343ccc84b55c22e2f411e268dfff5a5))
* **odoo:** isolate receipt recovery and align states ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C5 review) ([cf5c28d](https://github.com/ariefsaid/PMO/commit/cf5c28d0a5468aaf9141e347419a634177bdfbaf))
* **odoo:** link-existing works for native documents, linked totals follow Odoo, receipt quantities persisted ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P7 review) ([0ad1860](https://github.com/ariefsaid/PMO/commit/0ad1860e5e10b5a4688005ae7c8acc1362c851b4))
* **odoo:** model partial receipt backorders ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P1 review) ([81179a7](https://github.com/ariefsaid/PMO/commit/81179a7b5aadc282f852bbd46bac1ae2dd1df75e))
* **odoo:** model-qualified purchase refs, one transfer per receipt, bind the quantity-match rule ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P4 review) ([b545782](https://github.com/ariefsaid/PMO/commit/b54578293ebcce4b90a8d79237e8917131e0df6e))
* **odoo:** payment probe adopts exact anchor only, denominator entries, grant comment ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P2 review) ([676d1d3](https://github.com/ariefsaid/PMO/commit/676d1d30614c4d2fd8a9bde1b7c2dab504b8f2d7))
* **odoo:** receipt invoice must be an Odoo-tier ref, tax directory reads pinned to en_US and mirror price_include ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C2 review) ([a00bc90](https://github.com/ariefsaid/PMO/commit/a00bc904a9e797488cd91858721d470ce6fee400))
* **odoo:** recover withheld customer receipts ([9f28234](https://github.com/ariefsaid/PMO/commit/9f28234378144c13d4cd79227cbf28e3c6a41715))
* **odoo:** repair invoice recovery and revenue feed ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C6 review) ([0319b67](https://github.com/ariefsaid/PMO/commit/0319b67df09f96893fd7c1bf7a278b23c97c4594))
* **odoo:** route invoice-draft tier checks through the tier seam ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C3) ([d0b347e](https://github.com/ariefsaid/PMO/commit/d0b347ec8ecb5f1831c6c1be840fd958d26e0758))
* **odoo:** route receipt anchor through table ([34954c3](https://github.com/ariefsaid/PMO/commit/34954c340b4cbadf846e9caf2b507b073bf45082))
* **odoo:** use business references in purchase fixtures ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P0 review) ([73d820d](https://github.com/ariefsaid/PMO/commit/73d820dd5d1c6672d4b2e9935dad416752fedcbd))
* **odoo:** withheld receipt settles whole outstanding, down-payment line rejects own account, bad receipt id refuses ([#1506](https://github.com/ariefsaid/PMO/issues/1506) C1 review) ([ed6a472](https://github.com/ariefsaid/PMO/commit/ed6a472b3950251e2211288a7c8095a874e2da21))
* **overview:** one budget verdict - state the basis when committed orders push a within-spend project over ([#1531](https://github.com/ariefsaid/PMO/issues/1531)) ([1897475](https://github.com/ariefsaid/PMO/commit/1897475f7a2ec91a675d79bcb387f11d580f082b))
* **pipeline:** show a lost opportunity as "Lost", not "Loss Tender" ([b891cac](https://github.com/ariefsaid/PMO/commit/b891cace29dd3b82525d45d278da4ad9da1c702c))
* **plan-limits:** resolve pgTAP CI regressions ([870471e](https://github.com/ariefsaid/PMO/commit/870471ee6d3646debc4f6ca15314e035da4fffef))
* **plans-s6:** skip AC-PLN-015's S3-dependent arms, restore the switch per arm ([319ee58](https://github.com/ariefsaid/PMO/commit/319ee584d5f623ed6e6bd5ea67270d676fc2bf59))
* **plans:** edge functions honour feature switches on sync paths ([#1783](https://github.com/ariefsaid/PMO/issues/1783) item 2) ([a2effaf](https://github.com/ariefsaid/PMO/commit/a2effafdb24b64f4974c0c93d74633f99dc2fc31))
* **plans:** enforce the assistant switch, keep assistant writes fail-closed ([f14e47b](https://github.com/ariefsaid/PMO/commit/f14e47b7945ba4fbe5c60df55e3fe2cc9faf6406))
* **plans:** feature switch S1 follow-ups — core keys, compatibility, platform audit scope ([#1734](https://github.com/ariefsaid/PMO/issues/1734)) ([13f036f](https://github.com/ariefsaid/PMO/commit/13f036f5586ebc6dcd0092777babb645394f7e4c))
* **plans:** reconcile S3 and S4 merge gates ([e7b820a](https://github.com/ariefsaid/PMO/commit/e7b820ad805302299a6a58f8e46dabbb14d3da13))
* **plans:** register S1 tables/definers in isolation denominator and FE feature registry ([3a266f1](https://github.com/ariefsaid/PMO/commit/3a266f19efb0b27497bd1bc2df2f6a364907a0ed))
* **plans:** remove prose em dashes from S3 copy ([f2af1d1](https://github.com/ariefsaid/PMO/commit/f2af1d15a3b86983041dfbd70aa2c845b49895e8))
* **plans:** S3 review — org-scoped plan defaults, plan-bound limit draft, override presence ([73271f0](https://github.com/ariefsaid/PMO/commit/73271f074cfbf450be80319dd00b32907dfee52d))
* preserve loading status semantics in skeletons ([87cb3bf](https://github.com/ariefsaid/PMO/commit/87cb3bfd53e53491f4b0837d6c4fda9327788e27))
* preserve view editor state during navigation ([33b4e30](https://github.com/ariefsaid/PMO/commit/33b4e30ecbaf2432e504faf15aa6f14ca2091929))
* **procurement:** case status on every tab, receipt quantities, bill payment-awaiting line, setup journal save errors ([#1505](https://github.com/ariefsaid/PMO/issues/1505) P8 review) ([9965b75](https://github.com/ariefsaid/PMO/commit/9965b75ca1948b28d732e678e1976ece4ad6ed4a))
* **procurement:** detail-page Reject requires a rejection comment; classify 22023 ([#1578](https://github.com/ariefsaid/PMO/issues/1578)) ([6b811f6](https://github.com/ariefsaid/PMO/commit/6b811f6295abd23c563ca1df366bd59582a78f27))
* **projects:** change display label of Loss Tender to Lost ([9655d1b](https://github.com/ariefsaid/PMO/commit/9655d1b58b4949c4173bd6d2ac6bc6efc4d2cec4))
* **release:** repair v0.31.0 serial e2e blockers ([fc85916](https://github.com/ariefsaid/PMO/commit/fc859164793b2b651440174b9985f262d3fc4868))
* **release:** v0.31.0 e2e expectations, T&M e2e journey, evals via opencode ([dafe23d](https://github.com/ariefsaid/PMO/commit/dafe23deeac3fb59be62c4cfe5894203608c2226))
* restore feature-enabled edge test mocks ([cdabfa3](https://github.com/ariefsaid/PMO/commit/cdabfa362b94d5039e64604b18d78e7bb09d2278))
* **router:** hold browser Back/Forward in the unsaved-changes guard ([#1525](https://github.com/ariefsaid/PMO/issues/1525)) ([221d8be](https://github.com/ariefsaid/PMO/commit/221d8be66c64ae01bced9a10800062c669b1f94f))
* stabilize release layout e2e loads ([a573d8f](https://github.com/ariefsaid/PMO/commit/a573d8fdd64ce1b3d4a024038310718ce272a614))
* **t16:** gate-clean the extracted modules — shadow-type exemption moved to the shared contact form, i18n orphans pruned, keys added, optional mode callbacks, lint-clean helper modules ([4f1f09b](https://github.com/ariefsaid/PMO/commit/4f1f09be3d33e765f62b107bbb04ca4e10c088cb))
* **t37:** clarify project and delivery language ([#1569](https://github.com/ariefsaid/PMO/issues/1569)) ([074eb05](https://github.com/ariefsaid/PMO/commit/074eb053a08ef65a0f40463e60360cfcbbb9c749))
* **tm:** carry T&M sales item mappings forward ([#1802](https://github.com/ariefsaid/PMO/issues/1802) review) ([2bad44c](https://github.com/ariefsaid/PMO/commit/2bad44c2e253546949f7bd8c3cab77337fad3da2))
* **tm:** claim sources add up; single close button ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T8) ([9f8f66e](https://github.com/ariefsaid/PMO/commit/9f8f66ee08b570d5152b338c64e21de4a7566a4d))
* **tm:** flatten embedded billing states ([f1d3f86](https://github.com/ariefsaid/PMO/commit/f1d3f861e31e9bce476aca4ee557ab2e4b226758))
* **tm:** format the reshaped invoice line by invoice currency ([#1801](https://github.com/ariefsaid/PMO/issues/1801)) ([556b1ee](https://github.com/ariefsaid/PMO/commit/556b1ee58cd5cdf8574af99d42520aba80af8dc0))
* **tm:** keep the invoice-line formatter edge-safe ([#1801](https://github.com/ariefsaid/PMO/issues/1801)) ([91757dc](https://github.com/ariefsaid/PMO/commit/91757dc3595d7ab1ce768caf52487c96c9083b26))
* **tm:** let Finance/Admin end a rate assignee window ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T1 review) ([bee5636](https://github.com/ariefsaid/PMO/commit/bee56361f82f2913eb71259bef6c80afba690a17))
* **tm:** only re-shape half-cent tie lines ([#1801](https://github.com/ariefsaid/PMO/issues/1801)) ([de99988](https://github.com/ariefsaid/PMO/commit/de999881d37652a7d049c3d69181484eaa570b81))
* **tm:** plain copy, plurals, awaiting state, end rate and assignment, claim total ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T8 review) ([81954c4](https://github.com/ariefsaid/PMO/commit/81954c46e08d5b81374ec5dc7eb00f673d4a50c4))
* **tm:** preserve signed cents across ERP rounding ([#1801](https://github.com/ariefsaid/PMO/issues/1801) review) ([0b68c69](https://github.com/ariefsaid/PMO/commit/0b68c69a5c7c2b38d0ad206854ad4d44aa6ec049))
* **tm:** preserve signed claim cents in ERPNext body ([#1801](https://github.com/ariefsaid/PMO/issues/1801)) ([8b34dd8](https://github.com/ariefsaid/PMO/commit/8b34dd817b1ddeebb3310861c2c5b803a22049d3))
* **tm:** render billing panel on active contract route ([d304035](https://github.com/ariefsaid/PMO/commit/d3040350a454a3e5017d6f89f8ff7fc6ed53672e))
* **tm:** retain confirmed claim fixtures for AC-TM-018 ([c5d3c61](https://github.com/ariefsaid/PMO/commit/c5d3c617d51ff2aba9600b2d73a58833b46c97df))
* **tm:** send the save RPC's kind and currency, read the RPC's unrated preview rows, mirror both sign-off SoD identities ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T7 review) ([277d8f1](https://github.com/ariefsaid/PMO/commit/277d8f14e6ab4082d673cb1e620360080a40d517))
* **tm:** T&M invoice lines book exactly the signed amount ([#1801](https://github.com/ariefsaid/PMO/issues/1801)) ([aa52330](https://github.com/ariefsaid/PMO/commit/aa523307aa856ad8baf239b2636180cae77e2d4a))
* **tm:** tighten reader review coverage ([#1514](https://github.com/ariefsaid/PMO/issues/1514) T6 review) ([a42c570](https://github.com/ariefsaid/PMO/commit/a42c570d49250b1392713b6c8c8c1412d2e1d065))
* **ui:** make shared controls accessible ([#1545](https://github.com/ariefsaid/PMO/issues/1545)) ([0ee39bf](https://github.com/ariefsaid/PMO/commit/0ee39bf58bbf88c4c3e4b6070f376b6c8e0e9ff4))
* **ui:** restore feature and modal gates ([edccc36](https://github.com/ariefsaid/PMO/commit/edccc36fc3a84be0cf6de3701608f600d0d0881c))
* validate paste rows without money mapping ([7479aac](https://github.com/ariefsaid/PMO/commit/7479aac0da38d5992e93081576faf44bd985e1f5))
* **view-builder:** guard pending saves and stale views ([027e0a8](https://github.com/ariefsaid/PMO/commit/027e0a847ec87b15a289b02d3e4f45010d883ae6))


### Performance

* **#1741:** batch PM dashboard task reads, preload font, add baseline + measure script ([8d2dbac](https://github.com/ariefsaid/PMO/commit/8d2dbac8b8f4ede0623420c2fa64d3dcd740c256))
* **#1741:** page- and section-shaped skeletons from the shared ListState primitive ([1d00296](https://github.com/ariefsaid/PMO/commit/1d00296be36640fd882dd4e3f45c1addf578232d))


### Refactors

* **adapter-dispatch:** split the dispatch handler into adapters, money outbox, budget dispatch and attempt modules (T-42b) ([5d27a22](https://github.com/ariefsaid/PMO/commit/5d27a22feef2240a429aef8a7acc7692797068f6))
* centralize saved view storage ([48a18e0](https://github.com/ariefsaid/PMO/commit/48a18e022473f590768a6e383cf67ec1300ee80c))
* derive view compiler vocabulary from types ([93e44d0](https://github.com/ariefsaid/PMO/commit/93e44d01c69424ec39e9ae837da5f391ff4ed001))
* **erp-feed:** split the ERPNext feed dependencies into mirror scope, notifications, revenue, employee and mirror-write modules (T-42a) ([133a989](https://github.com/ariefsaid/PMO/commit/133a9890614dae8b86206408c916db7af0b5403f))
* **format:** share out page-local duplicate formatters into the canonical modules (T-34) ([0978fd1](https://github.com/ariefsaid/PMO/commit/0978fd1111b61d50b237174df7181531e48f8ccf))
* **project-detail:** separate task views and editing (T-44, [#1566](https://github.com/ariefsaid/PMO/issues/1566)) ([300b1db](https://github.com/ariefsaid/PMO/commit/300b1dbf9f82eea5aa936fe82889900a91309192))
* **repositories:** move remaining domain contracts ([15bf7fb](https://github.com/ariefsaid/PMO/commit/15bf7fb91f6b37eaa75a0f2c03d7c246f0f44e28))
* split ERP feed dependencies ([4915c9f](https://github.com/ariefsaid/PMO/commit/4915c9ff0647c7163a77f4b32160b07dd716f05a))
* **t16:** one shared company/contact/activity form; extract company, contact and admin-users modules; surface directory lookup states ([f704272](https://github.com/ariefsaid/PMO/commit/f704272d6dc7fd7556cc75e6d996918b19450d9d))

## [0.30.0](https://github.com/ariefsaid/PMO/compare/v0.29.0...v0.30.0) (2026-11-02)


### Features

* **#1605:** feed and onboarding match tax id first and persist a review row for an unclear party (ECA2-T14) ([3e6f30c](https://github.com/ariefsaid/PMO/commit/3e6f30ceedf43c28c8f3b0771bfae274b4507caf))
* **#1605:** purchase lines use the item map an accepted item link writes (ECA2-T15) ([2e6c44a](https://github.com/ariefsaid/PMO/commit/2e6c44aac12b6b2c5eb10aac3b956fd98655acef))
* **#1605:** repository verbs for census, status, proposals, accept-all loop, decide, unlink (ECA2-T16) ([586a9d4](https://github.com/ariefsaid/PMO/commit/586a9d4f8b29c210da6fdaacaae89cc607268a31))
* **#1605:** sweep pass advances open connect runs, one bounded step per tick (ECA2-T13) ([573e687](https://github.com/ariefsaid/PMO/commit/573e68748a3994610c25f96b2e94083641c158ff))
* **#1605:** the connect run loop with fail and expire (ECA2-T11) ([39434e5](https://github.com/ariefsaid/PMO/commit/39434e5b30318ca7a93e76ba5df4d4178a9462f9))
* **assistant:** 'Remind this person' action, eval suite and journey ([#1639](https://github.com/ariefsaid/PMO/issues/1639) S2–S4) ([006101c](https://github.com/ariefsaid/PMO/commit/006101ce313845bd00136ac7c12079c58f523b08))
* **assistant:** task reminder ledger with preview and send ([#1639](https://github.com/ariefsaid/PMO/issues/1639) S1) ([02801ff](https://github.com/ariefsaid/PMO/commit/02801ffbbbdf18f3bfe03ebd6caa53a027c43705))
* **db:** PO variations, revisions and client link ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S4) ([8e213e8](https://github.com/ariefsaid/PMO/commit/8e213e8558a16a89fa88fda2930049337aa7c8fd))
* **db:** subcontract bill caps ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S3) ([8765259](https://github.com/ariefsaid/PMO/commit/8765259341fa7b960dd940af81c3aece14e25e38))
* **eca-4:** a pre-cut-over purchase records its receipt, bill and payment through PMO ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([9f68ddd](https://github.com/ariefsaid/PMO/commit/9f68ddd88f6d21c40ae782f01819bf690b4c992e))
* **eca-4:** cut-over guard before adapter selection and in sweep replay; shared suite cutover.purchase ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([277d5ac](https://github.com/ariefsaid/PMO/commit/277d5ac2c6ab431cacf814d83f8d92d09c1fa2f2))
* **eca-4:** new labels in feature namespaces; bind setup tests to the shipped handler ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([28f03eb](https://github.com/ariefsaid/PMO/commit/28f03ebf7d4e71d5e7f59ab32116630c9ebbbb6c))
* **eca-4:** pre-cut-over label, employ refusal copy and declarations ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([f9cdf57](https://github.com/ariefsaid/PMO/commit/f9cdf57de2cbdcb0a0f634319abca3bf90a50e35))
* **equipment:** costing settings, hire-rate charges and reads ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S2) ([9a9b313](https://github.com/ariefsaid/PMO/commit/9a9b3138b4aa627ad450d7e3cbe91f4cebe9064c))
* **equipment:** equipment cost allocated through cost attribution ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S3) ([e9b7cea](https://github.com/ariefsaid/PMO/commit/e9b7cea7897ae3da50314a5a88fcc9c479c24401))
* **erp:** connect at any time — setup census, proposals and accept ([#1605](https://github.com/ariefsaid/PMO/issues/1605) data half) ([a6cbc51](https://github.com/ariefsaid/PMO/commit/a6cbc5102823852c6a8b694749025908d25ce637))
* **erp:** cut-over for purchases and claims in flight when the ERP connection is switched on ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([7c739f8](https://github.com/ariefsaid/PMO/commit/7c739f8d5af12efe567ad619ec6559ea727d24f9))
* **erp:** subcontract cap and revise guards fail closed ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S5) ([aa48a79](https://github.com/ariefsaid/PMO/commit/aa48a7967e29c2d6735581377a6840472e769dee))
* **pipeline:** required lost reason, win/loss by reason ([#1577](https://github.com/ariefsaid/PMO/issues/1577)) ([ce5323c](https://github.com/ariefsaid/PMO/commit/ce5323c89abbc71307e2752f9ee6d5d0400d87e6))
* **pipeline:** stage dates on cards, Signed pill, stage history editor, import date columns ([#1638](https://github.com/ariefsaid/PMO/issues/1638)) ([8b43efa](https://github.com/ariefsaid/PMO/commit/8b43efa126af0aa77a20a27bf0282a04db2ef2c2))
* **pipeline:** stage history records, backdating and import ([#1638](https://github.com/ariefsaid/PMO/issues/1638) database half) ([f49f135](https://github.com/ariefsaid/PMO/commit/f49f1350e410956584128f4ce37847f690129871))
* **subcontract:** ERP guards — exceptions block payment, bill-line attribution under the cap ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S5) ([a6094aa](https://github.com/ariefsaid/PMO/commit/a6094aac2e6a8893538c920b225f8f25d074053e))
* **subcontract:** PO variations, revisions, client link and Disputed position ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S4) ([aaa26d2](https://github.com/ariefsaid/PMO/commit/aaa26d28b2664502df1bc7a626bda31f227658f0))
* **subcontract:** subcontract acceptance, prepare and confirm ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S2) ([87df0e3](https://github.com/ariefsaid/PMO/commit/87df0e30edef2c663071b0a9cc7a05b1b933d4a8))
* **subcontract:** subcontract flag, purchase-order lines, revision 1 ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S1) ([aecb59c](https://github.com/ariefsaid/PMO/commit/aecb59c5270bfcef33061c2fb771e26198971330))
* **subcontract:** vendor bill caps against accepted work ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S3) ([81ef048](https://github.com/ariefsaid/PMO/commit/81ef048e681c433eabcdeda2be3f1fedfc4da74e))


### Bug Fixes

* **#1513:** name S5's linked-ERP-invoice readers in the actuals guard; drop the revise contract suite until a tier supports it ([#1505](https://github.com/ariefsaid/PMO/issues/1505)) ([e168a93](https://github.com/ariefsaid/PMO/commit/e168a93e6c9292a5ebb1a374d261938fdf6ea706))
* **#1605:** ECA-2 part A review round (name never links a person or account, binding-scoped proposals, bounded accept, audit trail) ([6f4fb74](https://github.com/ariefsaid/PMO/commit/6f4fb74f662435349a4d34dbd869055a9046df60))
* **#1605:** ECA-2 part B review round (disconnect purge, bound org-guard test, one map merge per accept, Minors 1-4, 6-7) ([2523e85](https://github.com/ariefsaid/PMO/commit/2523e85cbae7a6a5bd874498a669e66af0150ed1))
* **agent-dispatch:** conditional triggers leave no visible trace and notify once per automation ([9c73a79](https://github.com/ariefsaid/PMO/commit/9c73a79cf2ca45fd8e28651ee5037d2c4a95ff3e))
* **agent-dispatch:** reserve credit per automation unit and meter trigger conditions ([5d85b64](https://github.com/ariefsaid/PMO/commit/5d85b640a59f7d63ad760bc826c2b705cdf68c51))
* **agent:** hold assistant credit per request and release on every exit ([#1538](https://github.com/ariefsaid/PMO/issues/1538) T-10) ([9ecb8d9](https://github.com/ariefsaid/PMO/commit/9ecb8d9f87e9c082947a3e08cce769671b8a78cc))
* **agent:** hold credit atomically per chat and compose request, release on every exit ([b2a09b1](https://github.com/ariefsaid/PMO/commit/b2a09b19b55b77e23c4610afd4e351257698b744))
* **agent:** overdue report says partial when a scan or project scope is cut off ([578d3ea](https://github.com/ariefsaid/PMO/commit/578d3eadad91b448baf8f97cf23fb06c95b90f84))
* **agent:** page full result sets in user, event and thread lists; warn on rejected cancel request; tighten runtime cancel contract ([50d6b00](https://github.com/ariefsaid/PMO/commit/50d6b00867e029743a468b54721ccdd3bb847399))
* **assistant:** serialize attachment uploads, wait for uploads before send, re-evaluate stuck runs, ignore stale inbox loads, route thread list and rating via repository ([26ffd8f](https://github.com/ariefsaid/PMO/commit/26ffd8f40fb2f5e31544cd1c6deed7051abad91f))
* audit batch D1 — task-sync safety, ClickUp list picker, overdue honesty, assistant panel races ([#1535](https://github.com/ariefsaid/PMO/issues/1535) [#1537](https://github.com/ariefsaid/PMO/issues/1537) [#1538](https://github.com/ariefsaid/PMO/issues/1538)) ([fbce7a1](https://github.com/ariefsaid/PMO/commit/fbce7a11e83f56f7c1501468c374799c1e599f78))
* audit batch D2 — alert delivery, assistant lists, procurement lists and forms ([#1537](https://github.com/ariefsaid/PMO/issues/1537) [#1538](https://github.com/ariefsaid/PMO/issues/1538) [#1539](https://github.com/ariefsaid/PMO/issues/1539)) ([b0ec08a](https://github.com/ariefsaid/PMO/commit/b0ec08a4937b7542d0dc8145b0b2c25cf4ebd175))
* **clickup-client:** attempt a create exactly once and surface the outcome as unconfirmed ([e9398c1](https://github.com/ariefsaid/PMO/commit/e9398c17114406508ec3df5eca17caec8d917a6c))
* **clickup-sync:** compare-and-set mirror updates and claim-first adoption ([883e18a](https://github.com/ariefsaid/PMO/commit/883e18ae1c8a732f03a02957dd601c499fff0f4b))
* **clickup:** pin NULL-timestamp CAS branch; retry 429 on create POST; honor CAS result on matched adopt ([750db81](https://github.com/ariefsaid/PMO/commit/750db81faa3508c2acd285521952a9f952a65e3c))
* **db:** subcontract bill caps — shared billed figure, clear refusal, normalised audit, types ([#1513](https://github.com/ariefsaid/PMO/issues/1513) S3) ([6f589d7](https://github.com/ariefsaid/PMO/commit/6f589d7c5803a13e4dd50b5810f62465455e9c31))
* **eca-4:** cut-over instant, bill-first purchases, ERP-held rows stay read-only; drop the procurement/expenses employ guard ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([8b695eb](https://github.com/ariefsaid/PMO/commit/8b695eb73a2c2e5b24094b437beda665b5f59659))
* **expenses:** advance load is a required prop of the claim form; drop unused agingTotals rule ([8959e15](https://github.com/ariefsaid/PMO/commit/8959e150c55bf2ddbf03757c91bc065e6065cd71))
* **expenses:** advance picker past 500 rows, Save waits for advances, aging totals from the server ([#1540](https://github.com/ariefsaid/PMO/issues/1540) T-12) ([26f430e](https://github.com/ariefsaid/PMO/commit/26f430e80bdfa357c1f9b7f69308211947167786))
* **expenses:** claim form lists the caller's own advances past the page cap and waits for them; advance-aging totals cover every advance ([d57ffc8](https://github.com/ariefsaid/PMO/commit/d57ffc8a5341130ba33712306c157d04ebd4a904))
* **odoo:** three Odoo connect follow-ups from the O1 review ([#1614](https://github.com/ariefsaid/PMO/issues/1614)) ([1816322](https://github.com/ariefsaid/PMO/commit/1816322c935d32581acc702300140f1b8513e1ff))
* **pipeline:** wire StageDateDialog submitError and add projectStage to repository shape test ([#1638](https://github.com/ariefsaid/PMO/issues/1638)) ([c862442](https://github.com/ariefsaid/PMO/commit/c862442fb1a9d0e740afb2251af1b48afab9fb8b))
* prevent routine toast hover from blocking actions ([f0995ee](https://github.com/ariefsaid/PMO/commit/f0995eed3aa9cf40318ec9e7e51b923ad443152a))
* **procurement:** align PR/RFQ capture statuses to stored domain, open multi-file list from ledger, stop guessing timeline doc refs ([a798021](https://github.com/ariefsaid/PMO/commit/a798021c2cbb909f0bc73c70670f3541a576e5bd))
* **procurement:** import the shared procurementDetailKey after the dev merge ([#1601](https://github.com/ariefsaid/PMO/issues/1601)) ([f4aface](https://github.com/ariefsaid/PMO/commit/f4afacec5a13b1f7c9c53d1669777ae79036783c))
* **procurement:** load the full purchase list by keyset and show loading/error with retry in the ERP link dialog ([75ee2c1](https://github.com/ariefsaid/PMO/commit/75ee2c19728d2342dfdc804ae75d122cc13a8ef6))
* **procurement:** refresh list and project spend after detail-page changes; share procurement and ownership query keys ([6661941](https://github.com/ariefsaid/PMO/commit/6661941a960fb89ee0580aaa10489fb44917d703))
* **projects:** keep the sales-history doorway off the phone fold ([#1701](https://github.com/ariefsaid/PMO/issues/1701)) ([cb3ee5b](https://github.com/ariefsaid/PMO/commit/cb3ee5b9fffcb11b8c5a04aeb0c4b5198af6e4e1))
* **telegram-notify:** bound re-alerts by the cooldown from the last attempt, longer drain lease, log release failure ([e1b3a52](https://github.com/ariefsaid/PMO/commit/e1b3a525b5d93eaef8505f3bb798bee3365bb913))
* **telegram-notify:** reliable alert delivery, retry after failed send, single drainer lease ([128338e](https://github.com/ariefsaid/PMO/commit/128338e8aff8d7080a54646af1fa72a38f69fff1))
* **toast:** auto-dismiss restarts after effect cleanup, so a success toast never sticks (v0.30.0 release round 3) ([5f3c0c7](https://github.com/ariefsaid/PMO/commit/5f3c0c7f54aea072f92f92a7b2601b126031a625))
* unblock task status controls and update fixture history proof ([9b8b045](https://github.com/ariefsaid/PMO/commit/9b8b04547124328744fce6ce2e379ca96642600b))
* v0.30.0 release browser failures — toasts block clicks, phone fold on project pages ([0191a04](https://github.com/ariefsaid/PMO/commit/0191a041d167b4ec2f6e4de6b815ffd3ea043565))
* v0.30.0 release round 2 — hovering a routine toast no longer pauses it; stage-dates journey time limit ([4ee655a](https://github.com/ariefsaid/PMO/commit/4ee655acfa00dae89623c56bd7230a9fc4967d2f))

## [0.29.0](https://github.com/ariefsaid/PMO/compare/v0.25.1...v0.29.0) (2026-11-01)


### Features

* **#1600:** party.bring-in shared suite, ERPNext bringIn over onboardParties ([ef977f6](https://github.com/ariefsaid/PMO/commit/ef977f6819cae9f93b279fe1de5d1fcd783ebf5e))
* **adapter-seam:** ERP workflow registry and shared contract suites ([#1604](https://github.com/ariefsaid/PMO/issues/1604)) ([7a94058](https://github.com/ariefsaid/PMO/commit/7a94058119c2698e0e4a0823d4c802dc18650f31))
* **adapter:** ERPNext implements the shared read contract; poll spec shared with the sweep ([2074ad4](https://github.com/ariefsaid/PMO/commit/2074ad4d8ffc22fa404b68d90495e55fe564d903))
* **analytics:** survey policy and SDK survey boundary ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9-T3, T4) ([c624c8d](https://github.com/ariefsaid/PMO/commit/c624c8dfe3172e14af6a54d3a528d767f52e1cd9))
* **assistant:** draft a customer invoice without an ERP and notify the approvers ([#1595](https://github.com/ariefsaid/PMO/issues/1595)) ([0ece4b5](https://github.com/ariefsaid/PMO/commit/0ece4b52fc1df4f968c8f7923fae2b904ae24424))
* **assistant:** draft a customer invoice without an ERP, notify approvers ([#1595](https://github.com/ariefsaid/PMO/issues/1595)) ([8b0bc18](https://github.com/ariefsaid/PMO/commit/8b0bc189c08f614c0e05618743943319854da881))
* **billing:** 'Invoice this' on the billing-milestones block ([#1640](https://github.com/ariefsaid/PMO/issues/1640) S3) ([27bae35](https://github.com/ariefsaid/PMO/commit/27bae3578330ae9ef5fc014a6e0ec398dfea342b))
* **billing:** acceptance-age read path: types, DAL, repository, hook ([8b5f380](https://github.com/ariefsaid/PMO/commit/8b5f38050c4c70f395420657d4cf5bd0c85c7d5a))
* **billing:** billing kinds on invoices and contracts ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([d84b6a2](https://github.com/ariefsaid/PMO/commit/d84b6a2d6b1eaa5cfb3c0d52abaaabb29fe5b31f))
* **billing:** billing milestones block, acceptance age on WO card and Still-to-invoice ([#1640](https://github.com/ariefsaid/PMO/issues/1640) S2) ([efc1b75](https://github.com/ariefsaid/PMO/commit/efc1b7596adf1890b56fe1a336d0acfa64f5ca04))
* **billing:** Invoice this link on the billing milestones block ([#1640](https://github.com/ariefsaid/PMO/issues/1640) S3) ([08c655d](https://github.com/ariefsaid/PMO/commit/08c655d2433897ae59952b4137055aec9ee5d3ca))
* **billing:** one invoice gate for the card and the plan hand-off; ?invoice=1 opens the shipped dialog once ([#1640](https://github.com/ariefsaid/PMO/issues/1640) S3) ([f788211](https://github.com/ariefsaid/PMO/commit/f788211f4e6aea1bd7eb1c4fa87648216100ac03))
* **board-dnd:** dnd-kit dependency, board shell, drop resolver and drag copy ([#1637](https://github.com/ariefsaid/PMO/issues/1637) S1) ([7dee176](https://github.com/ariefsaid/PMO/commit/7dee176023bd6802407642acf80308a596851464))
* **boards:** drag and drop on the Sales Pipeline and project Tasks boards ([#1637](https://github.com/ariefsaid/PMO/issues/1637)) ([e59112f](https://github.com/ariefsaid/PMO/commit/e59112f353fc171f0e2c48e52f698e9bb380ce42))
* **dashboard:** headline invoiced figure with a monthly trend line ([#1597](https://github.com/ariefsaid/PMO/issues/1597)) ([44a0817](https://github.com/ariefsaid/PMO/commit/44a0817476b8c76487cce41eb5a500470ea28e6a))
* **db:** purchase attachment Microsoft source columns and Draft upload swap (0409) ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([beb7f54](https://github.com/ariefsaid/PMO/commit/beb7f54a82400fce185d9e4946a7d26443516007))
* **documents:** Microsoft, project and reference viewer targets ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([3ff30d1](https://github.com/ariefsaid/PMO/commit/3ff30d138c2b40a21d20d101852978d06f6fe52f))
* **documents:** persist SharePoint uploads through the repositories ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([62de041](https://github.com/ariefsaid/PMO/commit/62de041c3ac507d58ff35696e0330b575f8918b6))
* **documents:** project uploads follow the org default library ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([74f81e4](https://github.com/ariefsaid/PMO/commit/74f81e43efa0b3fd56ff9f77a84ce1e38cb23479))
* **documents:** purchase uploads follow the org default library; viewer journey ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([ccfe5d3](https://github.com/ariefsaid/PMO/commit/ccfe5d3e807aa3015a930dd835dbc5ee62eaa99d))
* **documents:** renderer selection, target types and Microsoft preview client ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([9b6a430](https://github.com/ariefsaid/PMO/commit/9b6a43069394d4bba4ea4b2c936cfc0b7241fc36))
* **documents:** side-panel document viewer, provider and private-storage adapter ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([f9d83ea](https://github.com/ariefsaid/PMO/commit/f9d83ead0997935a859728664243d708cf49c43e))
* **documents:** wire every entry point to the side-panel viewer ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([121f13b](https://github.com/ariefsaid/PMO/commit/121f13ba2e0162c3c91ff7e256b0d88b79da366e))
* **edge:** connected creation mirrors a known billing kind; refresh never touches it ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([aca7a36](https://github.com/ariefsaid/PMO/commit/aca7a360875d7bc03daa304bd0d25cf5afcc75e2))
* **equipment:** assets, usage entries and approval ([#1519](https://github.com/ariefsaid/PMO/issues/1519) S1) ([9983988](https://github.com/ariefsaid/PMO/commit/9983988a5acc4510701e0e15d538678f4924d9d5))
* **fe:** billing kind chosen beside the project on invoice creation ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([bb7593d](https://github.com/ariefsaid/PMO/commit/bb7593d473c6664e9bd46c269edbf10d7dfd14f6))
* **fe:** billing kind in record history ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([ef3a894](https://github.com/ariefsaid/PMO/commit/ef3a894c94e3c5f533479d34c279a257423e1542))
* **fe:** billing kind in the project assignment dialog and kind-only row action ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([e248985](https://github.com/ariefsaid/PMO/commit/e2489856c1cd2d6fb1b82a053d51c983b14ba713))
* **fe:** billing kind type, DAL and generated types ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([68ebf09](https://github.com/ariefsaid/PMO/commit/68ebf0938dba98f8e0b2a331400a628705d9ce55))
* **fe:** contract excess payload type and reconciling parser ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([b3d54ed](https://github.com/ariefsaid/PMO/commit/b3d54ed5970ec94363c0df14800241927abe5925))
* **feedback:** Admin switch lives in Organization integrations (Features is Operator-only), e2e ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9) ([e293872](https://github.com/ariefsaid/PMO/commit/e2938722bbc3ceb3446358511d6fe8a8fc095435))
* **feedback:** dashboard, docs, privacy copy, AC renumber ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9-T9, T10) ([925b843](https://github.com/ariefsaid/PMO/commit/925b843c4e71de0f524ca2924f5ef31aec97c3ba))
* **feedback:** Feedback button, prompted surveys host, survey facade ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9-T5..T7) ([0a2c3d0](https://github.com/ariefsaid/PMO/commit/0a2c3d04ce33f65c0e5c80b8e796d763dbf5ff35))
* **feedback:** org Admin switch, entitlement key and repository ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9-T2) ([e7376c3](https://github.com/ariefsaid/PMO/commit/e7376c3938d5af9c604344827a38db4e5633c90f))
* **feedback:** thumbs-down follow-up survey, in-flight save read at tick ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9-T8) ([f200e28](https://github.com/ariefsaid/PMO/commit/f200e283f91c4a088b76f325f95a8198cf67c4f0))
* **fe:** invoiced-above-contract excess with contributing invoices; explained unavailable comparison ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([e894516](https://github.com/ariefsaid/PMO/commit/e8945167fb0b89a4cb80a3b72eb05313974f227e))
* **fe:** repository seam carries billing kind to native create and assignment ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([4d47791](https://github.com/ariefsaid/PMO/commit/4d477918590a641a2d7d938f72d7bf4eae9968e2))
* **fe:** same-project kind correction path and cache refresh ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([ae49339](https://github.com/ariefsaid/PMO/commit/ae49339bfc399ca5120b7cfc9c3266a513dd37cf))
* **imprest:** charge an advance to a site float; release or move a Draft's float; match advances to the float ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5 fix) ([26abe7b](https://github.com/ariefsaid/PMO/commit/26abe7ba011adf32c67c79c6368f6afc144d0583))
* **imprest:** data layer, rules and policy ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S4) ([dab8845](https://github.com/ariefsaid/PMO/commit/dab8845e63aeb9ff82114795299cd183b735b091))
* **imprest:** derive the out-of-plan route for Submitted float claims ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5) ([75a6428](https://github.com/ariefsaid/PMO/commit/75a6428e91f8252cdcdf87d9ba68bfcb9692c053))
* **imprest:** ERP posting badge and the float cash-account screen ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6.9) ([766a75d](https://github.com/ariefsaid/PMO/commit/766a75d38f4f43351377254a822f0372bbf1ef99))
* **imprest:** float amount section, replenishment request guard, e2e journey ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5) ([1c524d7](https://github.com/ariefsaid/PMO/commit/1c524d758cec9d8b65fd679b9ec1f069886650ac))
* **imprest:** imprest-cash-account edge function binds a float's ERP cash account ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6.7) ([1bd0eb4](https://github.com/ariefsaid/PMO/commit/1bd0eb4b062039cc1af550597da9b0bb328709fa))
* **imprest:** imprest.transfer contract, ERPNext driver, float command variants and sweep pass 7b ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6) ([1bc11b8](https://github.com/ariefsaid/PMO/commit/1bc11b841212abca0ae3c83705a725068bc1e30f))
* **imprest:** pay from a float, replenish, return cash ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S2) ([d5a02b4](https://github.com/ariefsaid/PMO/commit/d5a02b4aebec4cdbf449425a3033f713515515a3))
* **imprest:** post site cash to the ERP ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6) ([528168f](https://github.com/ariefsaid/PMO/commit/528168fd3805fbe4f3930962c7585dea3cf2e126))
* **imprest:** site cash screens, float field and approvals ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5) ([1d23b01](https://github.com/ariefsaid/PMO/commit/1d23b017726178c1a93666729e23782b8015eaaf))
* **imprest:** site cash screens, float field on expenses, plan-aware approvals ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S4+S5) ([6f7aea1](https://github.com/ariefsaid/PMO/commit/6f7aea171da8683549460cc0ee3a2b19ba54a6d8))
* **imprest:** site float position, cash counts, float chooser and notifications ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S3) ([4dea478](https://github.com/ariefsaid/PMO/commit/4dea4789c6c1a3269c95156723b3c6b72d40efc4))
* **imprest:** site floats, float changes and monthly cash plans ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S1) ([6f15280](https://github.com/ariefsaid/PMO/commit/6f15280f62a79e90ee7f2ee83701bf9b1ad1f915))
* **m365:** upload client for SharePoint record files ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([b392747](https://github.com/ariefsaid/PMO/commit/b392747152ef79fba4778fac1b5bd987bb1ecae3))
* **odoo:** capability discovery and the version policy; the fake answers fields_get and has_access per model ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S3-T2..T4) ([978463d](https://github.com/ariefsaid/PMO/commit/978463dc7ab0773abc9203f022b386a7c2e80cab))
* **odoo:** companies Adapter — commit, reads and keyset changes ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T8) ([b82723a](https://github.com/ariefsaid/PMO/commit/b82723a7d4e05094773422f2aa6c89dcf59109bb))
* **odoo:** connect contract types and Odoo master normalisation ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T4/T5, AC-ODC-032) ([3dce010](https://github.com/ariefsaid/PMO/commit/3dce010a410d3dc06c691665d4de821ea9eb2e32))
* **odoo:** connect validation — one JSON-2 read plus the version probe ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S2-T1/T2) ([c925021](https://github.com/ariefsaid/PMO/commit/c9250210dae283ca4a9c1e83ae363f58c074900a))
* **odoo:** ConnectAdapter — list, count and lookup-then-create sends ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T6/T7) ([1c9d0e4](https://github.com/ariefsaid/PMO/commit/1c9d0e46645ec59bbb57034ea5c17aa7ccf73878))
* **odoo:** connection banner, hooks, role gates ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T3/T4) ([9947c2e](https://github.com/ariefsaid/PMO/commit/9947c2e3e3f2eff763bf579247647a9017440966))
* **odoo:** connection card with connect, activate, re-check, refresh, disconnect ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T5) ([f2ec52d](https://github.com/ariefsaid/PMO/commit/f2ec52da1d33c3bf1aa2949c24de1af1eb7f78ba))
* **odoo:** directory page, item picker, role-gate suite, route ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T7/T8/T9) ([0d9cecd](https://github.com/ariefsaid/PMO/commit/0d9cecd934adea5ad9083fd3e1fdabe8c7ec9ad8))
* **odoo:** directory repository, connection read, setup verb ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T1/T2) ([23a40e8](https://github.com/ariefsaid/PMO/commit/23a40e8dbc7c80d5e3d87998dd9b1d1b8c5319e3))
* **odoo:** en+id strings, directory a11y, table types ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T10) ([d8b8b40](https://github.com/ariefsaid/PMO/commit/d8b8b40ed11126e30dac08e1325dc3f186349c18))
* **odoo:** JSON-2 client with classified failures ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T1/T2, AC-ODC-002) ([1384b2a](https://github.com/ariefsaid/PMO/commit/1384b2ad59a576230fd750f2e6a04ce39bbe563d))
* **odoo:** Odoo 20 client, connect and activate an Odoo binding ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1 S2) ([31646d7](https://github.com/ariefsaid/PMO/commit/31646d7a27f65bcb2ecfcd6bae40e4a5e92be411))
* **odoo:** Odoo card, connection banner, directories and item picker ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([06209de](https://github.com/ariefsaid/PMO/commit/06209deeacfcc40ee751f635a66e296387f2d75b))
* **odoo:** Odoo section on Integrations with setup steps ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5-T5/T6) ([b43e1a5](https://github.com/ariefsaid/PMO/commit/b43e1a5aeefd8ffe2ffbefeba322b3f51ba953c2))
* **odoo:** one org's sweep tick: single flight on the ERP sweep lock, call and time budget, census, daily re-discovery, connection state ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S4-T10) ([5aae693](https://github.com/ariefsaid/PMO/commit/5aae693d9bcbf7ef4c9160d3becfc2f1b0a6056e))
* **odoo:** one strict parser per directory kind; discovery checks every field the sweep reads or scopes by ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S4-T6, S4-T7) ([dce77d1](https://github.com/ariefsaid/PMO/commit/dce77d15f107e5b5cf61fe9e4ae5287759ee9a20))
* **odoo:** pace Odoo requests, 5 per second, 1 on Odoo-operated hosting ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S3-T1) ([02d0817](https://github.com/ariefsaid/PMO/commit/02d081726f7bf3606840d6787b1c7e10189d4717))
* **odoo:** pacing, discovery, connection state, directory mirror and sweep ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S3 S4) ([a01cb50](https://github.com/ariefsaid/PMO/commit/a01cb50645bb734338d5cede7209b0dbccd9c8eb))
* **odoo:** shared master-send suites, Odoo harness and workflow declarations in parity ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T9, AC-ODC-095) ([c3f031a](https://github.com/ariefsaid/PMO/commit/c3f031a801850ca698fa53050bfbcda502471466))
* **odoo:** the connection-state machine and the stale-healthy display rule ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S3-T5) ([ddc2c0a](https://github.com/ariefsaid/PMO/commit/ddc2c0add1b2b96703e870116bd35675f9ac0ca0))
* **odoo:** the per-kind sweep: resumable initial scan, (write_date, id) keyset feed with a 10-minute overlap, daily census ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S4-T8, S4-T9) ([7b87917](https://github.com/ariefsaid/PMO/commit/7b87917f64539f61264e2df326242237d846bf7d))
* **posthog:** AI dashboard, feedback joins its trace, privacy copy, docs and runbook ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1-T5..T9) ([cc523d0](https://github.com/ariefsaid/PMO/commit/cc523d048c465688c710bdb27f1ae779b6ceb3b1))
* **posthog:** AI traces for agent-chat and compose-view with demo-org text, consent link, online evals ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1-T3,T4) ([54e68cd](https://github.com/ariefsaid/PMO/commit/54e68cd5e5276cc1fd3e1d753595a19e9dee38da))
* **posthog:** AI traces, job health, alerts and source maps, business events, demo funnel, feedback surveys ([#1532](https://github.com/ariefsaid/PMO/issues/1532)) ([823d571](https://github.com/ariefsaid/PMO/commit/823d5710e9034ebb884727830c43412e526917eb))
* **posthog:** business event builders and facade ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S5-T1) ([bc863f8](https://github.com/ariefsaid/PMO/commit/bc863f863d28618049b84ad799c29341b771e4e0))
* **posthog:** CI check that each registered job wraps in withJobRun ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S3-T3) ([aeb9fe1](https://github.com/ariefsaid/PMO/commit/aeb9fe19a9a91bd31b03240fcb21613f101b4579))
* **posthog:** consent flag from the browser; telemetry is a no-op without a PostHog key ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1) ([f75fd65](https://github.com/ariefsaid/PMO/commit/f75fd65254ed201180fd885e6a5eb2ce77ddb6e7))
* **posthog:** demo money-path funnel, prospect-only, by account ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S6-T2) ([b387fb7](https://github.com/ariefsaid/PMO/commit/b387fb792d39ad9d162e5d9a09854c9f9e2fcafd))
* **posthog:** deploy-only source-map upload, then delete from dist ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S2-T2/T3) ([122be52](https://github.com/ariefsaid/PMO/commit/122be5286073c7ba5feb9f7d6faebb36eced6251))
* **posthog:** fire the four business events on success paths ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S5-T2) ([9ab107f](https://github.com/ariefsaid/PMO/commit/9ab107f5013a69d63c028be3632add4e267ef6c1))
* **posthog:** generic server emitter with per-event key allowlists ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S0-T2) ([835a97c](https://github.com/ariefsaid/PMO/commit/835a97cf75c303b1a4aec4955f145aaf6bff4f47))
* **posthog:** online-eval judge with Claude guard and sampling ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1) ([3f65571](https://github.com/ariefsaid/PMO/commit/3f655716947e6ad4f281afa232101fc449237343))
* **posthog:** pre-register the four business events and the facade seam ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S0-T4) ([ad99a2f](https://github.com/ariefsaid/PMO/commit/ad99a2f816defc824f71565e6bb1ffd20539714d))
* **posthog:** quota --dump to capture a live fixture; capture steps ([#1532](https://github.com/ariefsaid/PMO/issues/1532) Q-T1) ([fc99b79](https://github.com/ariefsaid/PMO/commit/fc99b79e8dfbe9f93d228f2ba1cd4810cf0210d9))
* **posthog:** release id on FE exceptions ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S2-T4) ([2088ac9](https://github.com/ariefsaid/PMO/commit/2088ac9d5f37b623ff4b5d79b444b367c4066185))
* **posthog:** server-event producer registry and tile gate extension ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S0-T3) ([e6cdabb](https://github.com/ariefsaid/PMO/commit/e6cdabb7083f2b490987e2e9b339632551d0b240))
* **posthog:** text-key gate, link keys and ai_eval on the server allowlist ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1) ([b6e7306](https://github.com/ariefsaid/PMO/commit/b6e73064bd76cd1137b0bec178178d3e1866dcb7))
* **posthog:** typed AI emitters with consent-gated text and link ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1-T2) ([6ad8fea](https://github.com/ariefsaid/PMO/commit/6ad8fea679bee55a17c56197864af31c6362d04b))
* **sales:** drag-and-drop on the Sales Pipeline board, same rules and confirms as the status menu ([#1637](https://github.com/ariefsaid/PMO/issues/1637) S3) ([bbb43a6](https://github.com/ariefsaid/PMO/commit/bbb43a657db37fae6922f8f61ac8d5419d448a10))
* **stock:** adjustments, stock counts and two-person write-offs ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S4) ([5f04362](https://github.com/ariefsaid/PMO/commit/5f043625d3f481342f3d7e17dbf0d18d6964b02d))
* **stock:** consumption and allowance DAL, repository, hooks and policy; types in the public schema ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([50cdaf1](https://github.com/ariefsaid/PMO/commit/50cdaf157d63eef11d3e07d3a8dfbe16b3cb2fed))
* **stock:** consumption report on the project Materials tab ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([85e2f7d](https://github.com/ariefsaid/PMO/commit/85e2f7d0eecad080196b3cee661949d24abe607d))
* **stock:** count sheet and adjustment screens, draft edit, write-off post rules on the detail page ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S4) ([0626260](https://github.com/ariefsaid/PMO/commit/06262604d56048f18aca745f604bdc2505cfd386))
* **stock:** error parser, repository, hook, policy entities, i18n namespace ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([fbff4f3](https://github.com/ariefsaid/PMO/commit/fbff4f36411b835ae9770797e47d7c0095dbcd56))
* **stock:** flag over-allowance on a posted issue's confirmation ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5, OQ-STK-7) ([c41db91](https://github.com/ariefsaid/PMO/commit/c41db912861f63967187913f8b752b2276f2fd3f))
* **stock:** material allowance editor on the bill of quantities ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([3125d7b](https://github.com/ariefsaid/PMO/commit/3125d7bfa637a411b0050f8a31a5b7fd1c0fda5c))
* **stock:** material allowances and per-project consumption report ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([86d5803](https://github.com/ariefsaid/PMO/commit/86d5803462c0671ee4437b4cd2489b6529ff1fd9))
* **stock:** movement forms, on hand, documents, ledger pages, Materials tab, routes, nav and i18n ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([f1561c3](https://github.com/ariefsaid/PMO/commit/f1561c34e5ced40ff09165f854d0d7c762057229))
* **stock:** post stock in and out, on-hand and movement screens ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S2a S2b S3) ([3e18138](https://github.com/ariefsaid/PMO/commit/3e1813899614b580a47679ab4138f20725741ac0))
* **stock:** posting RPC allow-list, tenant isolation, rollback and types ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S2a) ([76673a3](https://github.com/ariefsaid/PMO/commit/76673a3cb31bedb4ec0291e07e9d6e5743d218a4))
* **stock:** read RPCs for on hand and the ledger trace, cost hidden below rank 20 ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([a5662a2](https://github.com/ariefsaid/PMO/commit/a5662a20498fb14c37ff5cd2996fab27969ba3b3))
* **stock:** reorder DAL, repository, hooks and policy; Reorder breadcrumb ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S6) ([9d5c1b8](https://github.com/ariefsaid/PMO/commit/9d5c1b8cc524b8e2ae4aa1c973107e9489be70f5))
* **stock:** reorder levels, suggestions and below-level worklist ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S6) ([d19ea28](https://github.com/ariefsaid/PMO/commit/d19ea282900478c06709b7e02df6a67897c8fb74))
* **stock:** Reorder screen, route and tab; Below reorder level filter on Stock on hand ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S6) ([03edc5c](https://github.com/ariefsaid/PMO/commit/03edc5c4ca79f1e7c2fe917d9858193212630f87))
* **stock:** stock document and report DAL, repository, hooks and document policy ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([4fef545](https://github.com/ariefsaid/PMO/commit/4fef5451cf9b1435f3204fa4219b2580a79bc58e))
* **stock:** stock master DAL and generated types ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([60bc36d](https://github.com/ariefsaid/PMO/commit/60bc36d807f027d31042411fc21f9ca2ebbca808))
* **stock:** stock setup screen and route ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([ec4c8b8](https://github.com/ariefsaid/PMO/commit/ec4c8b895facc81671ec96a7df839844db81f087))
* **stock:** the approver sees live system quantity, difference and value; post pins the revision; reopened cost on file; breadcrumb names the document ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S4) ([2097c3b](https://github.com/ariefsaid/PMO/commit/2097c3b29be733b1f6f86162f43ca25f24dfc2a9))
* **stock:** units, items, warehouses and keepers — stock setup ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([0a507c4](https://github.com/ariefsaid/PMO/commit/0a507c436a7ac5b7743b667707155f179d0b045f))
* **tasks:** drag a task card to another status column on the project Tasks board ([#1637](https://github.com/ariefsaid/PMO/issues/1637) S4) ([b8e8caf](https://github.com/ariefsaid/PMO/commit/b8e8cafc99d6b32305639eb097b13d023e80654a))
* **timesheets:** Copy last week into the current draft week ([dab04d4](https://github.com/ariefsaid/PMO/commit/dab04d4b04bad24bd5ce4fa737b1556eb3242058))
* **timesheets:** pure copy-last-week merge planner ([adc9cec](https://github.com/ariefsaid/PMO/commit/adc9cec280000bc4f0b2fa1b26d22e728331931f))


### Bug Fixes

* **adapter-seam:** gate-wiring test anchors on the per-tier money-outbox resolver call ([7a77fe0](https://github.com/ariefsaid/PMO/commit/7a77fe061452865064c0b22f28e559abc7c05630))
* **assistant:** unconfirmed native timeout, no duplicate milestone Draft on retry, honest approver note ([#1595](https://github.com/ariefsaid/PMO/issues/1595)) ([5ddcfa6](https://github.com/ariefsaid/PMO/commit/5ddcfa66ba289bbde179bc2897a23f3db8261d38))
* **billing:** Invoice this — fail closed on read errors; cover claim gate, lines wait, once-only ([#1640](https://github.com/ariefsaid/PMO/issues/1640)) ([d2b4e5a](https://github.com/ariefsaid/PMO/commit/d2b4e5af03677fa0aa3464c6d9466e93f50f0522))
* **billing:** show contract-invoiced amount alongside the billing excess ([#1631](https://github.com/ariefsaid/PMO/issues/1631)) ([7de358e](https://github.com/ariefsaid/PMO/commit/7de358e6e8e918e3a618f5032c8a8f5239c2ea7e))
* **board-dnd:** narrower auto-scroll edge zones so a wide board does not scroll past the target column ([#1637](https://github.com/ariefsaid/PMO/issues/1637)) ([d2d28c7](https://github.com/ariefsaid/PMO/commit/d2d28c7c3d51510f266b9ce537f4ca3ff241497d))
* **board-dnd:** review round for [#1637](https://github.com/ariefsaid/PMO/issues/1637): no cue on the home column, win errors stay in the form, mid-drag axe, full-width drag preview ([c66bfed](https://github.com/ariefsaid/PMO/commit/c66bfed1ef796fdebd93db61cf489054e61d239d))
* **dashboard:** invoiced headline is the 12-month total with its symbol; wider labelled trend chart; 4-digit-year months ([#1597](https://github.com/ariefsaid/PMO/issues/1597)) ([16606bd](https://github.com/ariefsaid/PMO/commit/16606bdf1f7e2ca2dbc5222109053e188e709ee4))
* **dashboard:** type the trend input to the totals it reads; label the tile as a total with a monthly line ([#1597](https://github.com/ariefsaid/PMO/issues/1597)) ([e36ffaa](https://github.com/ariefsaid/PMO/commit/e36ffaa0959641e9bc033bf55c0464db006ebec7))
* **db:** transition RPC refusals keep their code and detail ([405f3f9](https://github.com/ariefsaid/PMO/commit/405f3f900526c21e1799df8976a4a19d9ba0cf94))
* **documents:** M365 error copy covers the preview and upload wire codes; embed guard records the seven attachment-table profile pairs from 0409 ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([65bc03b](https://github.com/ariefsaid/PMO/commit/65bc03b5c63f8d640aa0f7c69f374516d10b9f12))
* **documents:** purchase ledger counts and previews SharePoint-backed attachments; file cell uses the repository download ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([f49b963](https://github.com/ariefsaid/PMO/commit/f49b96323ac754f6e84ac775234599e7d5bb4ca6))
* **documents:** short-lived link for the public Office viewer; PDF frame sends no referrer; Retry test presses Retry ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([661373d](https://github.com/ariefsaid/PMO/commit/661373dd60def151db4d787c47d62af836dadc8a))
* **documents:** upload failure copy covers invalid files and purchase attachments; no double toast; unknown destination never uploads privately ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([28d64cf](https://github.com/ariefsaid/PMO/commit/28d64cf191a06922a853d7e3dd65086accdd169b))
* **documents:** viewer Retry loads once; no side effect inside a state updater ([#1474](https://github.com/ariefsaid/PMO/issues/1474)) ([536db64](https://github.com/ariefsaid/PMO/commit/536db64884901abe387f1693c50aaa6e8960beb3))
* **erp:** aging report validates its envelope and money cells; malformed reports use the labelled fallback ([e86859f](https://github.com/ariefsaid/PMO/commit/e86859f47d1c4ff9a3e0b32134d1254a3e7d9d08))
* **erp:** budget, timesheet and archive recovery queues serve least-recently-attempted first (0427) ([ae246ba](https://github.com/ariefsaid/PMO/commit/ae246badbab2ec10ea2788b1b5de0dbb8a97a60e))
* **erp:** finish ERP scans and recover uncertain writes (T-08) ([0e6d046](https://github.com/ariefsaid/PMO/commit/0e6d0469f4ba5b9361a4f60c040d9d1a323d6ceb))
* **erp:** hourly sweep is stamped complete only when its passes finish; truncated or failed runs resume promptly; invocation deadline keeps later orgs' money passes running ([918b4af](https://github.com/ariefsaid/PMO/commit/918b4af45545b262bd3da1da81d2fd18cd2e9aed))
* **erp:** keyset cursor pads modified to 6 fractional digits so text order is time order ([909340d](https://github.com/ariefsaid/PMO/commit/909340d5464323b5235e674d7d1d5d1b6052d600))
* **erp:** ledger and doctype scans resume by a composite (modified, name) keyset; ledger mirror reads only changed rows ([3d9fc14](https://github.com/ariefsaid/PMO/commit/3d9fc14d24c569b41fba5e5b743211a9ec76a3b6))
* **erp:** link an existing company on ERP connect instead of creating a second one ([#1600](https://github.com/ariefsaid/PMO/issues/1600)) ([d631ea1](https://github.com/ariefsaid/PMO/commit/d631ea15a024b898c7d4b7748cd672764cc0a217))
* **erp:** list reads reject malformed envelopes as unconfirmed; fenced probe-failure re-read keyed on the outbox identity; unconfirmed push copy ([0771967](https://github.com/ariefsaid/PMO/commit/077196715b0def629a3337ebf514225c14587e58))
* **erp:** one company per ERP party; shared adapter contract ([#1600](https://github.com/ariefsaid/PMO/issues/1600), [#1604](https://github.com/ariefsaid/PMO/issues/1604)) ([a4c193f](https://github.com/ariefsaid/PMO/commit/a4c193f2c0b3a64ec9f1f520db8db8a69e739a9f))
* **erp:** the adapter change feed judges a legacy bare watermark at instant granularity — caught-up stays null ([56a220d](https://github.com/ariefsaid/PMO/commit/56a220d7493ae0b8d69b0708dbf00d250687eb0f))
* **feedback:** translate Feedback button and Admin switch (en+id), count active days in org timezone, extend 0419 pgTAP ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S9) ([cae7da5](https://github.com/ariefsaid/PMO/commit/cae7da5e7f1d5dc3a0af84f0760a59ae14927c02))
* **fe:** excess block outside the definition list; axe graduated into AC-004 ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([f521747](https://github.com/ariefsaid/PMO/commit/f5217478d9413b9cf2fe57eee551d51841580198))
* **i18n:** billing kind copy lives in the finance namespace (common keys are frozen) ([#1471](https://github.com/ariefsaid/PMO/issues/1471)) ([fc11584](https://github.com/ariefsaid/PMO/commit/fc11584f72b89f09313b4c204915abd8772aecf2))
* **imprest:** chooser drops the float amount; renumber to 0428; disambiguate by currency then neutral suffix ([#1635](https://github.com/ariefsaid/PMO/issues/1635)) ([23eaffd](https://github.com/ariefsaid/PMO/commit/23eaffdd957cc70d3ef53bcb1a2ed8208fd0bb7f))
* **imprest:** float chooser RPC returns currency, amount and project name so claimants see them ([#1635](https://github.com/ariefsaid/PMO/issues/1635)) ([16875b3](https://github.com/ariefsaid/PMO/commit/16875b3019f77f6a3c91177759965c7e31e5cbbb))
* **imprest:** fold posting states to the worst per movement; honest truncation on the float detail ([38eba2f](https://github.com/ariefsaid/PMO/commit/38eba2fc708e343379c0c20ce51d8dc67ce08cd9))
* **imprest:** fund site floats from the binding's bank account only, no cash-account fallback ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6 review 6) ([8278f3f](https://github.com/ariefsaid/PMO/commit/8278f3fe1cc7dd3f6da1b2974534020c798cdcdc))
* **imprest:** own desk-cancel notice for a site float transfer; document poll-only cancel ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S6 review 4) ([6e77d02](https://github.com/ariefsaid/PMO/commit/6e77d0280934a65974a4555630e5dbc9ba7db2f3))
* **imprest:** plan-aware approval route read, one float by id ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5 fix) ([25a8044](https://github.com/ariefsaid/PMO/commit/25a80449644aa76e7a7c6f64a73cd7c6e8f24dba))
* **imprest:** route imprest notifications to people who can act; counts write-once ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S3 review) ([78de2b8](https://github.com/ariefsaid/PMO/commit/78de2b84795aed67710091fa2163312b011771fb))
* **imprest:** show float-scoped amounts in the float currency; label float picker by project ([#1635](https://github.com/ariefsaid/PMO/issues/1635)) ([8d9ce16](https://github.com/ariefsaid/PMO/commit/8d9ce16bf7ab6756509ccb13afd6db129179a312))
* **imprest:** tables sit inside the section cards without a second frame; 0178 count recorded ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5 fix) ([fcfd94e](https://github.com/ariefsaid/PMO/commit/fcfd94e6648049d9bafb1ceaea765849c4ccb373))
* **imprest:** the float record page names its breadcrumb from its own by-id read ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5 fix) ([6ec7be4](https://github.com/ariefsaid/PMO/commit/6ec7be4feb59fcb2c8d0148f6ea0ec912479e6cc))
* **imprest:** unfunded float reads Not yet funded, count variance on the list, request amount, section cards and float history table ([#1515](https://github.com/ariefsaid/PMO/issues/1515) S5 fix) ([bd552cc](https://github.com/ariefsaid/PMO/commit/bd552cccd5d3f5ac7c33e643f3a5ed9b9854be0b))
* **integration:** ERP parity gate covers every tier on disk and runs its suites from one runner; tier-branch guard catches constant and includes spellings ([78f71c5](https://github.com/ariefsaid/PMO/commit/78f71c5135ed8d25c6f31a7ba707723a09a49c1d))
* **integration:** setup claims the ERP link before writing a company; unclear matches notify; names match across punctuation and case ([771b8f8](https://github.com/ariefsaid/PMO/commit/771b8f83b3b5740d808410800f962339c6462ec7))
* **odoo:** a feed backlog resumes where it stopped, every kind keeps budget, reset waits for a running sync ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S4) ([d965f92](https://github.com/ariefsaid/PMO/commit/d965f92b4504568114b30d7af8bad85ad310f60a))
* **odoo:** comma-safe search, server-search Combobox for the item picker, reconnect, scoped lookups, parent breadcrumb ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5 review) ([02620b9](https://github.com/ariefsaid/PMO/commit/02620b96d9db8784e2d85351c889241159fe1993))
* **odoo:** connect refuses an Odoo below 20 or of unknown version; every company is listed; a refused connect is audited ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S2) ([e7121ca](https://github.com/ariefsaid/PMO/commit/e7121ca5d8b4e8585052f0e91df5c5bf931a9e55))
* **odoo:** displayed state follows the binding, discovery deadline, pace clamp, recheck rate limit, version-probe failure ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S3) ([331e7d4](https://github.com/ariefsaid/PMO/commit/331e7d4add967c3e5b534b37334dd84ff725e0ae))
* **odoo:** master-data tableId, connect card surfaces rejected save via submitError ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([5db9875](https://github.com/ariefsaid/PMO/commit/5db9875bfd5da98b2172e758d58545ea093066ed))
* **odoo:** Reconnect carries no icon, distinct from Re-check ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([b85fe7c](https://github.com/ariefsaid/PMO/commit/b85fe7c52d5aab283f0168a3b9b0c65182452e2a))
* **odoo:** route time and number display through the format seam ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([9cfe4c2](https://github.com/ariefsaid/PMO/commit/9cfe4c24fbe834fd3915d7e6dc3380191e034792))
* **odoo:** tier-agnostic connect refusals, kind-to-model lookup lives in the adapter ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([ed4909e](https://github.com/ariefsaid/PMO/commit/ed4909e2cf344f24580b16405d690fd7ecdd0a10))
* **odoo:** warehouse headings follow the page h1 ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S5) ([c5e8852](https://github.com/ariefsaid/PMO/commit/c5e8852fe4dc392d5025c1c035022bc67e49706b))
* **posthog:** Deno-clean telemetry types, lint and tsc-clean tests ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S1) ([f704b7d](https://github.com/ariefsaid/PMO/commit/f704b7db6ead33f227eb25b1eb2425776168c0da))
* **posthog:** review fixes for [#1532](https://github.com/ariefsaid/PMO/issues/1532) batch (job failure, judge hardening and spend, compose span, privacy copy) ([dc43940](https://github.com/ariefsaid/PMO/commit/dc439404f6a0039473c0d0557f2a1a65cfa325c0))
* **posthog:** source-map step warns instead of failing a deploy build; maps always deleted ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S2) ([7b95cf7](https://github.com/ariefsaid/PMO/commit/7b95cf779569350ace9d099b310f0aee8d3697f8))
* repository contracts; dashboard money trend ([#1554](https://github.com/ariefsaid/PMO/issues/1554), [#1597](https://github.com/ariefsaid/PMO/issues/1597)) ([381c435](https://github.com/ariefsaid/PMO/commit/381c435c6f2cd73731c7aec01c22ea421d6b042e))
* **stock:** [Stock &gt; page] breadcrumbs, ledger shows the time, on-hand tiles, form heading ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([6d65162](https://github.com/ariefsaid/PMO/commit/6d651621383f8b7334c54c2e52628c4bdf6e9f91))
* **stock:** a reopened draft line names its item; count and adjustment read [Stock &gt; page] ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S4) ([ab0a62b](https://github.com/ariefsaid/PMO/commit/ab0a62b29922d7c90913449c6bae6b93a3ccaa9f))
* **stock:** a write-off post carries the reviewed revision; a re-saved draft keeps its stored cost; rank-gated line cost read ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S4) ([bee0701](https://github.com/ariefsaid/PMO/commit/bee0701904bb523b3bce225e220f2a0a1fbc6a3d))
* **stock:** allowance clear confirm, view-as on Billing allowance action, reversed range message, exact e2e oracle ([8c68027](https://github.com/ariefsaid/PMO/commit/8c680278c71b706ebbc4482164a909b48c799bdd)), closes [#1626](https://github.com/ariefsaid/PMO/issues/1626)
* **stock:** breadcrumb title for /stock/setup ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([efd15ac](https://github.com/ariefsaid/PMO/commit/efd15acb7c50f868a031c194a1f76c819ac1190e))
* **stock:** consumption months follow the org's today; AC-STK-001 gains the consumption oracle ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([0e61452](https://github.com/ariefsaid/PMO/commit/0e61452e10bd124ae1e21da58091739f1a9fda36))
* **stock:** consumption tables scroll by keyboard at phone width; record the NFR-STK-003 timing ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([ab8df76](https://github.com/ariefsaid/PMO/commit/ab8df7638b07d0f98b12e60393f683ed6d3470e6))
* **stock:** isolation manifest, view-as, avg-cost null, ledger date, create-page header, rail icon ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([175b4e4](https://github.com/ariefsaid/PMO/commit/175b4e47d735e7cf526dddc3ad29688bbae378a8))
* **stock:** item picker matches form controls, ledger date column fits, embedded ledger keeps its width ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S3) ([14ae8a6](https://github.com/ariefsaid/PMO/commit/14ae8a67475e3c946b0a7935b8bd435e095e17ef))
* **stock:** keeper created_by has no profiles FK (embed-ambiguity guard) ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([6e6cbc2](https://github.com/ariefsaid/PMO/commit/6e6cbc23098edbf53d43b2b7caf34adfca3715ba))
* **stock:** return line lock no longer clashes with FK key-share, ledger line_id index, service role loses trigger/references ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S2b) ([9395c46](https://github.com/ariefsaid/PMO/commit/9395c46fc27fd372f0374741930c4c01d72dddd0))
* **stock:** setup topbar title carries its i18n key; Show archived moves into the tab row ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([9a672c5](https://github.com/ariefsaid/PMO/commit/9a672c57d4b1beebc1faa99f0f7abab0b8c5657f))
* **stock:** share-lock warehouses and items at post so an archive cannot race a post ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S2b) ([5687646](https://github.com/ariefsaid/PMO/commit/56876468fc06ad83d728dd3cfa9adcf05af589dd))
* **stock:** tabpanel wiring, view-as read-only, failed lookups are errors on the setup screen ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S1) ([2bc3ed4](https://github.com/ariefsaid/PMO/commit/2bc3ed47c5c38b0a92349c36827118816f5ca4ea))
* **stock:** units on reorder level and quantity, STK_INVALID for bad quantity or oversize level, no negative suggestion, on-hand filter lists never-stocked pairs, failed clear keeps its dialog ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S6) ([23f87e0](https://github.com/ariefsaid/PMO/commit/23f87e06e486004be15bced77b5eb1bffc0cfb28))
* **test:** retained RPC count is 90 after [#1612](https://github.com/ariefsaid/PMO/issues/1612) and [#1615](https://github.com/ariefsaid/PMO/issues/1615) both landed ([fdaac20](https://github.com/ariefsaid/PMO/commit/fdaac208f86b15f6c7597a0a7251acf1ccdeb187))
* **ui:** let RecordHeader action slot and procurement waiting note wrap at 320px ([#1591](https://github.com/ariefsaid/PMO/issues/1591)) ([04f0037](https://github.com/ariefsaid/PMO/commit/04f00375c4d3703074bc59ba95ff120530f6d7d2))


### Performance

* **test:** unit suite 44→20.5 min — kill per-file barrels, lazy DOM-only setup, 70 pure-logic suites to node ([9d49c0e](https://github.com/ariefsaid/PMO/commit/9d49c0edcd88c92a7a1b8bac0f683f64081b9cd8))


### Refactors

* **adapter-seam:** lift the party matcher into connect/match.ts so every tier shares it ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S1-T9) ([f58012e](https://github.com/ariefsaid/PMO/commit/f58012e7f1b8c7bd0b9b37b90349ffd2cef35131))
* **adapter:** remove unused external adapter seams ([b82a88a](https://github.com/ariefsaid/PMO/commit/b82a88a67c6d76108406e310620751fdfd0f3a0b))
* **data:** hooks consume repositories, comment repository added, offset paging option removed ([ca57461](https://github.com/ariefsaid/PMO/commit/ca5746155ed3f197bf970f4b076047d68934d01c))
* direct reads behind repositories ([#1555](https://github.com/ariefsaid/PMO/issues/1555), T-30) ([916a90e](https://github.com/ariefsaid/PMO/commit/916a90ea5ef888a99a1c4ecc5b30e6831a25bc2e))
* **hooks:** route 14 hooks through typed repositories ([#1632](https://github.com/ariefsaid/PMO/issues/1632)) ([a859d10](https://github.com/ariefsaid/PMO/commit/a859d100966b9afaa5932f8e56c2ba21658ad191))
* **integration:** split ERP dispatch preparation by business domain ([8cd66a3](https://github.com/ariefsaid/PMO/commit/8cd66a3d128ff84cb66653286ca6461a45daac86))
* **integrations:** the browser stops reading the secret reference; setup requests take a tier ([#1504](https://github.com/ariefsaid/PMO/issues/1504) S2-T5) ([c91296d](https://github.com/ariefsaid/PMO/commit/c91296dd9958c8e2207ef8c1a37c1ceab1bb5fe9))
* **posthog:** split dashboard provisioning into testable modules and per-slice spec fragments ([#1532](https://github.com/ariefsaid/PMO/issues/1532) S0-T1) ([6640c3e](https://github.com/ariefsaid/PMO/commit/6640c3ec79ed2bd5427371fe4bbd88391a5952b4))
* **project-status:** share confirm copy, win fields and eligibility query between menu and board drop ([#1637](https://github.com/ariefsaid/PMO/issues/1637) S2) ([61da5b1](https://github.com/ariefsaid/PMO/commit/61da5b1c805f5ebeb5ac8c2e31bae8eff8ef1405))
* **repositories:** invoice evidence reuses the shared edge error parser ([4ac571a](https://github.com/ariefsaid/PMO/commit/4ac571a0b51d7416dddfac3fe156e88c7f1d86a0))
* **statements:** focus response validators into dedicated modules ([91c5d10](https://github.com/ariefsaid/PMO/commit/91c5d10e933426f81756634899888735cf973203))
* **stock:** month-range helpers in stockFormat, month labels through the format seam ([#1512](https://github.com/ariefsaid/PMO/issues/1512) S5) ([876d156](https://github.com/ariefsaid/PMO/commit/876d15668ace2d2e3b5d444bc205de0ed2703ff4))


### Chores

* release 0.29.0 ([194b3cb](https://github.com/ariefsaid/PMO/commit/194b3cbefee4fea30f8575bd8dbce472e224a779))

## [0.25.1](https://github.com/ariefsaid/PMO/compare/v0.25.0...v0.25.1) (2026-10-23)


### Bug Fixes

* v0.25.1 Engineer purchasing scope, member audit history, assistant model tiers ([#1309](https://github.com/ariefsaid/PMO/issues/1309)) ([7caff02](https://github.com/ariefsaid/PMO/commit/7caff02955d1aa9962e1cda417d6b884aac4ac08))

## [0.25.0](https://github.com/ariefsaid/PMO/compare/v0.24.0...v0.25.0) (2026-10-23)


### Features

* v0.25 ERP purchases, contract quantities, M365 record folders, one-step create, assistant accuracy and hardening ([#1292](https://github.com/ariefsaid/PMO/issues/1292)) ([e3b80db](https://github.com/ariefsaid/PMO/commit/e3b80db845726c1606333df8fe56daa3e9b861f9))


### Bug Fixes

* **deps:** pin DOMPurify 3.4.17 for three published advisories ([#1304](https://github.com/ariefsaid/PMO/issues/1304)) ([7e56b1d](https://github.com/ariefsaid/PMO/commit/7e56b1dc2ea8b9e2a7012f953af0250c76c47065))

## [0.24.0](https://github.com/ariefsaid/PMO/compare/v0.23.0...v0.24.0) (2026-10-20)


### Features

* **admin:** migrate admin tools tables to DataTable (T8) ([#1259](https://github.com/ariefsaid/PMO/issues/1259)) ([87ebcc1](https://github.com/ariefsaid/PMO/commit/87ebcc15716196432552e8e824f44f51b7aadce6))
* **billing:** quiet the Billing tab — non-zero figures only, one tax label, fold empty quantity billing (SUB-B) ([4a7e9c2](https://github.com/ariefsaid/PMO/commit/4a7e9c22157ca404cc5485cd9a59d6cbbd07e3f6))
* **budget:** budget line items, forecast grid and account map adopt DataTable (T5) ([1b9476e](https://github.com/ariefsaid/PMO/commit/1b9476ed2bbf64f438f0d018f5591702d3a396aa))
* **budget:** budget tab subtraction - forecast only with an Active version, one incomplete line, no single-version bar or footer total (SUB-D) ([584d7ce](https://github.com/ariefsaid/PMO/commit/584d7ceeb221be9c7ff713cf405f918c5f3edb9a))
* **dashboard:** aging report date and basis once per card, not per party row (SL-F) ([bec9ab8](https://github.com/ariefsaid/PMO/commit/bec9ab8b3c5dcc74d5cfc1401897ea78a0c52971))
* **dashboard:** approvals tile and mobile band only while something waits (SL-A) ([d059883](https://github.com/ariefsaid/PMO/commit/d059883e9d76af7d54b2747b9b19e00a6359103e))
* **dashboard:** one risk note; no uncomputable margin tile or Active projects tile (SL-B) ([c44a333](https://github.com/ariefsaid/PMO/commit/c44a33309c3e1587e697538d0b4bd0c9c074db20))
* **dashboard:** short-form money on KPI tiles and stat tiles, exact in title and sr text; dash-with-reason for unknowns (RD-S1) ([6757154](https://github.com/ariefsaid/PMO/commit/6757154719896bae500df8d7a77d5d273feb3ace))
* **expenses:** move expense and receipt tables onto the shared table (T6) ([#1249](https://github.com/ariefsaid/PMO/issues/1249)) ([e1385a1](https://github.com/ariefsaid/PMO/commit/e1385a172cfa4f9187671d6ce89db1dde500d122))
* **finance:** invoice form drops tax-base, prompt, helper and ERP standing lines; no e-Faktur on drafts (FIN-S3) ([336324e](https://github.com/ariefsaid/PMO/commit/336324eadfeed61d409f74804ab60f1d5059f10c))
* **finance:** invoice list on the shared table, one primary cell, 7 columns; drop project filter, sort button, Date/Received columns, Browse Projects (FIN-S1, T4) ([d48bd67](https://github.com/ariefsaid/PMO/commit/d48bd676d9b45ab82f99f9e7c21fbf859511434c))
* **finance:** invoice record states each fact once, shows evidence only when it exists (FIN-S2) ([88fbdce](https://github.com/ariefsaid/PMO/commit/88fbdce5a4828fd91448d3617f47659976406f45))
* **finance:** receipts list to seven columns; record shows only figures that say something; one outstanding sentence on the form (FIN-S5) ([10e5570](https://github.com/ariefsaid/PMO/commit/10e5570518939a1b75eff9b290e8707e5974a792))
* **fx:** quiet equivalents — nothing when unsupported, undated or loading; one short failure line, no Retry (FIN-S4) ([1d2ac44](https://github.com/ariefsaid/PMO/commit/1d2ac44d51985069d1950b0786a129d2ee21bd64))
* **history:** kind chips only when needed; relative time only (SUB-G) ([897fd57](https://github.com/ariefsaid/PMO/commit/897fd57e8fe0bc81be3bf8e18709a124c2847372))
* **i18n:** per-feature translation namespaces + guard ([#1070](https://github.com/ariefsaid/PMO/issues/1070)) ([3b45483](https://github.com/ariefsaid/PMO/commit/3b454831ab8d95d01383fdec5023a0b137bf9989))
* **procurement:** move line items and quote comparison onto the shared table (T7) ([#1250](https://github.com/ariefsaid/PMO/issues/1250)) ([d7ef875](https://github.com/ariefsaid/PMO/commit/d7ef87525125aa3982de218229be927e0c529284))
* **project-tabs:** drop restating subtitles, duplicate empty actions, document count, Next line; New revision to row menu (SUB-E) ([2841520](https://github.com/ariefsaid/PMO/commit/2841520d12c60501bd4b535964c3520149540fa3))
* **project:** compact header strip, one details disclosure (PD-A) ([2ee0b54](https://github.com/ariefsaid/PMO/commit/2ee0b54d6e4773b93a7f9be2d29a9d2784c5458e))
* **project:** opportunity lens shows only what the deal state needs (SUB-I) ([a275bb8](https://github.com/ariefsaid/PMO/commit/a275bb836a17d669468c1700f16916e43d5039f9))
* **projects:** adopt shared DataTable hierarchy (T2) ([869a185](https://github.com/ariefsaid/PMO/commit/869a1859f250bd59a6635a73a8872fc3743449bf))
* **projects:** clarify overview spending setup ([#1044](https://github.com/ariefsaid/PMO/issues/1044)) ([268ca8e](https://github.com/ariefsaid/PMO/commit/268ca8e207ce703e5d52f44e4e21de60b01f18e3))
* **projects:** no empty phase line; pre-win has no work orders or billing tab (SUB-A) ([7306e7d](https://github.com/ariefsaid/PMO/commit/7306e7d9f72d8197902d463a92be278a93650918))
* **projects:** overview renders only blocks with data (PD-B) ([49ce89f](https://github.com/ariefsaid/PMO/commit/49ce89f91701efc85ad042242805c0194186f538))
* **projects:** project finances shows fewer lines (PD-C) ([211c53a](https://github.com/ariefsaid/PMO/commit/211c53a1d935ddcad61cb0e29955d3cd5e021480))
* **reports:** management pack drops the position section, keeps one Export and no monthly-scope lines; project table totals per currency with full amounts (FIN-S8, T10, [#1260](https://github.com/ariefsaid/PMO/issues/1260)) ([8b557a4](https://github.com/ariefsaid/PMO/commit/8b557a4fc005bc542cace37b0a1c8b4d590f8185))
* **revenue:** revenue by project - two money tiles, one clickable Unassigned row, export-only currency, full amounts with per-currency totals; orphaned copy removed (FIN-S6, T10) ([0458df2](https://github.com/ariefsaid/PMO/commit/0458df21b8139e81d8afd3bdb6a7a46652464cef))
* **sales:** neutral funnel bars, board stage names in the table, mixed-currency stages show a dash with the reason (RD-S5) ([19e62da](https://github.com/ariefsaid/PMO/commit/19e62dad768010cd82265ad6d8af40179f40b44a))
* **sales:** pipeline table on the shared primary-cell contract; phone has no view toggle (T4) ([0eb9689](https://github.com/ariefsaid/PMO/commit/0eb96893091aa36708915bc591e21993df41d5c4))
* **shell:** drop Vendors and the My Tasks sub-line from the rail; My integrations moves to the account menu (FIN-S9) ([5afd50e](https://github.com/ariefsaid/PMO/commit/5afd50efef87b0370361af288357f2cff2878163))
* **table:** DataTable hierarchy contract + saved widths everywhere (T1) ([b9a0aa8](https://github.com/ariefsaid/PMO/commit/b9a0aa8dcb6b91d5a4f123cefdeff9b67fe66cdc))
* **table:** TanStack-backed DataTable with resizable columns ([#1232](https://github.com/ariefsaid/PMO/issues/1232)) ([e72f0d7](https://github.com/ariefsaid/PMO/commit/e72f0d7aa5fd36194d85077b039046156592dbfc))
* **tasks:** ClickUp card shows only when connected or linked; linked is one line (SUB-F) ([1c11e8d](https://github.com/ariefsaid/PMO/commit/1c11e8d69522b2024cce3df6a7db6b38a1052316))
* **timesheets:** weekly grid adopts DataTable - sticky-left project column, editable cells, totals in the table foot (T9) ([5ba3cfb](https://github.com/ariefsaid/PMO/commit/5ba3cfbf44766e47c6714ba166d1b617134555c6))
* **ui:** Base UI confirmation dialog pilot (ADR-0090 slice 01) ([2188fe0](https://github.com/ariefsaid/PMO/commit/2188fe0b335d1d9e1ee84d2d605d276ec2b319d2))
* **ui:** short-form figure contract for KPITile/StatTiles with exact title + sr text (RD-S1) ([4a7e27a](https://github.com/ariefsaid/PMO/commit/4a7e27ac90d7bb8eb4a72590ed8a2707bcc852a3))
* v0.24 declutter, shared tables, dashboards and accounting-format statements ([eace9e7](https://github.com/ariefsaid/PMO/commit/eace9e7d903f44f376c295e5b0c5b695fa3c40f8))
* v0.24 declutter, shared tables, dashboards and accounting-format statements ([#1265](https://github.com/ariefsaid/PMO/issues/1265)) ([eace9e7](https://github.com/ariefsaid/PMO/commit/eace9e7d903f44f376c295e5b0c5b695fa3c40f8))
* **work-orders:** drawdown only with work orders, one tax label, trim per-row repetition (SUB-C) ([f87c0ed](https://github.com/ariefsaid/PMO/commit/f87c0edc6df53b0f489beaf7ba83152af0e36ce4))


### Bug Fixes

* **admin:** explain retained unavailable account drafts ([#1179](https://github.com/ariefsaid/PMO/issues/1179)) ([db6a604](https://github.com/ariefsaid/PMO/commit/db6a604e095599768a870003db559fc19e5bfe75))
* **dashboard:** correct money figure fallback and locale (RD-S1) ([33f7fef](https://github.com/ariefsaid/PMO/commit/33f7fefade59cbcc8dd0415a01921622403b7227))
* **dashboard:** make unknown figures explicit (RD-C1, RD-C2) ([ddd389c](https://github.com/ariefsaid/PMO/commit/ddd389c9db8623c85e36bccb30812b034492db93))
* **dashboard:** PM dashboard delivery-only counts, visible names, labelled margin ([#1238](https://github.com/ariefsaid/PMO/issues/1238)) ([#1253](https://github.com/ariefsaid/PMO/issues/1253)) ([28599e3](https://github.com/ariefsaid/PMO/commit/28599e3fdacc9a2924b26b6f528ca13c20e90d2a))
* **dashboard:** RD-S1 discover fixes - exact approval money, revealable unknowns, short-form minors (RD-S1) ([ecc30d5](https://github.com/ariefsaid/PMO/commit/ecc30d56f2f7df0df6d58d3db2dc31ac4d8711c2))
* **dashboard:** truthful executive figures on real data ([#1231](https://github.com/ariefsaid/PMO/issues/1231)) ([d4daa71](https://github.com/ariefsaid/PMO/commit/d4daa71cdf7c104b8a72c30b4010d0fa0e1cc51d))
* **e2e:** browser listing ignores node:test helpers; budget journey reads the line row, not the new totals row ([07336c2](https://github.com/ariefsaid/PMO/commit/07336c29075646e2c63a749c27f0527180425e9e))
* **erpnext:** align activation read permissions ([#1217](https://github.com/ariefsaid/PMO/issues/1217)) ([#1222](https://github.com/ariefsaid/PMO/issues/1222)) ([a9cc15e](https://github.com/ariefsaid/PMO/commit/a9cc15e75b5acbfda7e7f107a69250d1cb9c27f8))
* **finance:** make empty-state actions role-aware (S-26) ([#1230](https://github.com/ariefsaid/PMO/issues/1230)) ([57415f4](https://github.com/ariefsaid/PMO/commit/57415f4280d8bea650cc0746910ba578ee05b616))
* **i18n:** statement period labels live in the finance namespace ([8fcdeae](https://github.com/ariefsaid/PMO/commit/8fcdeae15a22573bbfed9e3c821500af04ce5015))
* **i18n:** use phase vocabulary across project surfaces ([#1018](https://github.com/ariefsaid/PMO/issues/1018)) ([#1229](https://github.com/ariefsaid/PMO/issues/1229)) ([f507997](https://github.com/ariefsaid/PMO/commit/f507997ed8f90649712ad9b77238836e2d076488))
* **project:** keep the Back-to-Sales-Pipeline link on the opportunity lens (SUB-I) ([994ec7c](https://github.com/ariefsaid/PMO/commit/994ec7ca9e44a39084afa6c298f9d9967ba37e85))
* **projects:** Filters panel defers outside dismissal; e2e journeys follow the calmer table (PL-A) ([a1883cc](https://github.com/ariefsaid/PMO/commit/a1883cca2f3e02997d9b0cab18ba1f06fb3e971f))
* **projects:** show a lasting message when unlinking fails [v0.24 hold] ([#1206](https://github.com/ariefsaid/PMO/issues/1206)) ([f72bb81](https://github.com/ariefsaid/PMO/commit/f72bb815877b8ae82943bcf62f58e261b174cb45))
* **purchasing:** dismissible More menu and Bahasa preview labels ([#1207](https://github.com/ariefsaid/PMO/issues/1207)) ([44df072](https://github.com/ariefsaid/PMO/commit/44df072d3a29588fe1e5634d54cd048be4345e10)), closes [#1155](https://github.com/ariefsaid/PMO/issues/1155)
* **reports:** name the pack project table 'Project' so the As-at field label stays unique (FIN-S8) ([a3348ae](https://github.com/ariefsaid/PMO/commit/a3348aed41b9862c340694daef32815267b437fc))
* **shell:** vendors stay reachable without CRM; drop dead Browse-projects hints ([77ba9d3](https://github.com/ariefsaid/PMO/commit/77ba9d3b2cf729c3fbbbfd10da042e887dc939c3))
* **statements:** show statements in standard accounting format ([a02888f](https://github.com/ariefsaid/PMO/commit/a02888f0b0991be50958f78889162e7fbf5f8208))
* **statements:** unstick first publication on slow ERP hosts ([#1202](https://github.com/ariefsaid/PMO/issues/1202)) ([7b7a71f](https://github.com/ariefsaid/PMO/commit/7b7a71f89767d9eb7d8b3c3813018f31803abf6a))
* **table:** resize handles — inert when min=max, hover/focus visible, on-boundary line, header tab order, kbd Enter/Shift/Escape, primary column reflow ([#1239](https://github.com/ariefsaid/PMO/issues/1239)) ([b585fb0](https://github.com/ariefsaid/PMO/commit/b585fb0884440eeb757115f18918fae319d5d77e))
* **timesheets:** shared employee choice labels; recover an unavailable choice in place ([#1153](https://github.com/ariefsaid/PMO/issues/1153), [#1154](https://github.com/ariefsaid/PMO/issues/1154)) ([#1224](https://github.com/ariefsaid/PMO/issues/1224)) ([bdef989](https://github.com/ariefsaid/PMO/commit/bdef98946c6cb934265b85541029997224e0f24a))
* **ui:** keep card actions outside the heading name ([#1262](https://github.com/ariefsaid/PMO/issues/1262)) ([222af86](https://github.com/ariefsaid/PMO/commit/222af86832dbc4fd1222da636bf14f959cf0265d))
* **ui:** overview cards shrink on phones; last column's resize handle stays inside the table ([dfb39ef](https://github.com/ariefsaid/PMO/commit/dfb39ef87c74f3e3eda64100a321bf2841f75a15))


### Refactors

* **projects:** calm the Projects table, each fact once (PL-A) ([d4bc7a2](https://github.com/ariefsaid/PMO/commit/d4bc7a2e3f2a547766ac17fa2c72787a37c84c87))
* **projects:** cards and board say each fact once (PL-B) ([de760c9](https://github.com/ariefsaid/PMO/commit/de760c9ca0de093445b8feef3d498b0ed4266b60))
* **sales:** subtract pipeline description, stage totals, code lines, End customer column, phone toggle/details (SUB-H) ([598aec5](https://github.com/ariefsaid/PMO/commit/598aec5f8f35b66a5ddd533f5f810616328bc3ab))

## [0.23.0](https://github.com/ariefsaid/PMO/compare/v0.22.0...v0.23.0) (2026-10-19)


### Features

* **billing:** start invoices from the project context ([#1142](https://github.com/ariefsaid/PMO/issues/1142)) ([f227942](https://github.com/ariefsaid/PMO/commit/f227942171e77552da44f02fa436cff985f2bb1e))
* choose ERP accounts and items in accounting setup ([#1150](https://github.com/ariefsaid/PMO/issues/1150)) ([8808d92](https://github.com/ariefsaid/PMO/commit/8808d92717554aa22b0188c6072f96dd9200b349))
* disclose secondary tax facts on record surfaces ([#1162](https://github.com/ariefsaid/PMO/issues/1162)) ([19307e3](https://github.com/ariefsaid/PMO/commit/19307e3da56b423dfa5ea4c040eb1aae1843eb21))
* **expenses:** receipt-first draft capture (S-29) ([#1168](https://github.com/ariefsaid/PMO/issues/1168)) ([39dc295](https://github.com/ariefsaid/PMO/commit/39dc2953f244c553f26d1545de910ab294c4188e))
* extract project money position ([#1128](https://github.com/ariefsaid/PMO/issues/1128)) ([3c67546](https://github.com/ariefsaid/PMO/commit/3c675462493a4bc69d05042f6738da8715f12614))
* **finance:** add statement metadata readers ([#1122](https://github.com/ariefsaid/PMO/issues/1122)) ([cbc0551](https://github.com/ariefsaid/PMO/commit/cbc055189ee790f5cc5ac1d9a74cea06e91ceef5))
* **finance:** connect customer aging to collections ([#1181](https://github.com/ariefsaid/PMO/issues/1181)) ([31294cf](https://github.com/ariefsaid/PMO/commit/31294cffea573cd8017dec5b480efee0a7d99921))
* **finance:** read native ERPNext statements losslessly ([#1124](https://github.com/ariefsaid/PMO/issues/1124)) ([5958127](https://github.com/ariefsaid/PMO/commit/59581270a5ee4038781fd1b7f718f5af4380eae8))
* **history:** lead with business summaries and retain details ([#1138](https://github.com/ariefsaid/PMO/issues/1138)) ([bc70432](https://github.com/ariefsaid/PMO/commit/bc70432cd25c9dd89be2e2f16f4b99c443a39a61))
* **integrations:** review existing ERP project matches before confirming (S-09) ([#1208](https://github.com/ariefsaid/PMO/issues/1208)) ([b9630d4](https://github.com/ariefsaid/PMO/commit/b9630d4efedfa95b0a3ec1fb4ca6d9e40cb565b8)), closes [#1135](https://github.com/ariefsaid/PMO/issues/1135)
* **integrations:** review task-list links before confirmation ([#1177](https://github.com/ariefsaid/PMO/issues/1177)) ([00e067c](https://github.com/ariefsaid/PMO/commit/00e067cfbbe6e3842ce4f75f0ae0be244724cea5))
* **purchasing:** clarify request states and daily actions ([#1165](https://github.com/ariefsaid/PMO/issues/1165)) ([b875783](https://github.com/ariefsaid/PMO/commit/b8757832fc50aab91e967d2f53fe0869cc0fa6b6))
* **receipts:** retain optional withholding in a clear disclosure ([#1141](https://github.com/ariefsaid/PMO/issues/1141)) ([292f69f](https://github.com/ariefsaid/PMO/commit/292f69f2672f8e947da4eabd7cd9e7c07994d3ac))
* **reports:** show current project position ([#1187](https://github.com/ariefsaid/PMO/issues/1187)) ([2746672](https://github.com/ariefsaid/PMO/commit/274667260e380aa3b166e6d765143aed88e28f10))
* review employee identity before confirmation ([#1152](https://github.com/ariefsaid/PMO/issues/1152)) ([58e0e5d](https://github.com/ariefsaid/PMO/commit/58e0e5d614189d53855057fdf487bb1b2fb081cd))
* review invoice amounts before creating a draft ([#1151](https://github.com/ariefsaid/PMO/issues/1151)) ([c0baddb](https://github.com/ariefsaid/PMO/commit/c0baddb0d0f75bf22759f29eb09030cf795ba536))
* **sales:** make the phone pipeline a readable stage list ([#1140](https://github.com/ariefsaid/PMO/issues/1140)) ([e2381cc](https://github.com/ariefsaid/PMO/commit/e2381ccd81ecc4431ecc700c45ef55694ff87e1b))
* **search:** find records by canonical reference ([#1163](https://github.com/ariefsaid/PMO/issues/1163)) ([2997921](https://github.com/ariefsaid/PMO/commit/299792147cd82f99f888e616e92977325e74c938))
* **statements:** add accessible period picker ([#1119](https://github.com/ariefsaid/PMO/issues/1119)) ([f95dbfd](https://github.com/ariefsaid/PMO/commit/f95dbfd80336cdf3b367cf9917a94c4f9f9c374d))
* **statements:** collect and publish native ERPNext reports ([#1126](https://github.com/ariefsaid/PMO/issues/1126)) ([148aa79](https://github.com/ariefsaid/PMO/commit/148aa79ec8fbec6835e7fe528686bc2583f7ac58))
* **statements:** complete the ERP statement source ([#1074](https://github.com/ariefsaid/PMO/issues/1074)) ([301d433](https://github.com/ariefsaid/PMO/commit/301d433af5e982d694e8d2fbb6cac2b09a6461c3))
* **statements:** display saved company and project reports ([#1146](https://github.com/ariefsaid/PMO/issues/1146)) ([19a0f7f](https://github.com/ariefsaid/PMO/commit/19a0f7f2d5f2b7f17a91aa4ef7e854bd1708fb13))


### Bug Fixes

* complete project cash and numbering correctness checks ([#1118](https://github.com/ariefsaid/PMO/issues/1118)) ([595afaa](https://github.com/ariefsaid/PMO/commit/595afaa1a6ad35a08d2fac2761ea01d8b33f4a08))
* finalize native report refresh and release checks ([#1212](https://github.com/ariefsaid/PMO/issues/1212)) ([512db8b](https://github.com/ariefsaid/PMO/commit/512db8bebc6d394727dd5798ae912a73f29c48ee))
* **finance:** align actuals, completeness and project review ([#1147](https://github.com/ariefsaid/PMO/issues/1147)) ([bdc2c27](https://github.com/ariefsaid/PMO/commit/bdc2c27d02b71e79ac9c4b9600cb95352d952e22))
* **integrations:** clearer ERP project match review (S-09 follow-up) ([#1218](https://github.com/ariefsaid/PMO/issues/1218)) ([263ca5c](https://github.com/ariefsaid/PMO/commit/263ca5ccf18df401888feffab26bf1cf5e0cf9ad)), closes [#1135](https://github.com/ariefsaid/PMO/issues/1135)
* **projects:** keep a typed location while other filters commit ([#1209](https://github.com/ariefsaid/PMO/issues/1209)) ([f1686f4](https://github.com/ariefsaid/PMO/commit/f1686f411162ae4deba0256d130fe383cf268b76)), closes [#1000](https://github.com/ariefsaid/PMO/issues/1000)
* **projects:** load detail panels on demand ([7dadb1d](https://github.com/ariefsaid/PMO/commit/7dadb1d79f215bf967b7fb5041e63ffb04df6a75))
* **projects:** load only the selected detail panel ([135a8b9](https://github.com/ariefsaid/PMO/commit/135a8b98cddba282d961a0049d4e93d453eea315))
* retain invoice presence when earlier amounts net to zero ([#1130](https://github.com/ariefsaid/PMO/issues/1130)) ([eafbfc6](https://github.com/ariefsaid/PMO/commit/eafbfc6f5e0e0e100fe1854f0952c1d9d71bbd60))
* **tax:** readable tax-details toggle that keeps the header height ([#1169](https://github.com/ariefsaid/PMO/issues/1169)) ([ee28bae](https://github.com/ariefsaid/PMO/commit/ee28bae6ce55c3a6e24612c941f3c8216e3ead63))

## [Unreleased] — v0.23.0 validation disposition

The owner accepted the rehearsal data-path evidence on 2026-10-19: ordinary Finance reads and
saved-report provenance were validated against the captured ERPNext output. The remaining local
screen-render check was blocked by private test tooling. It does not block release preparation.
The owner deliberately moved that screen check to after production deployment and the first
statement backfill (approximately one hour), when Claude will verify the real Finance screen.
This changes the timing of the screen check; the data-correctness requirements remain in force.
Production deployment still requires separate explicit owner approval.

## [0.22.0](https://github.com/ariefsaid/PMO/compare/v0.21.0...v0.22.0) (2026-10-17)


### Features

* **admin:** clarify accounting and project setup (S-31) ([#1063](https://github.com/ariefsaid/PMO/issues/1063)) ([17bdf2a](https://github.com/ariefsaid/PMO/commit/17bdf2ac2aedba5e03fad52710de9f5704d3a4bf))
* **admin:** propose budget posting accounts once (S-10) ([#1076](https://github.com/ariefsaid/PMO/issues/1076)) ([cf8ec08](https://github.com/ariefsaid/PMO/commit/cf8ec08009e10c0650184bb136284f77aae88468))
* **admin:** show the resolved spend-approval route (S-32) ([#1065](https://github.com/ariefsaid/PMO/issues/1065)) ([1e4770c](https://github.com/ariefsaid/PMO/commit/1e4770c0fcc50995a3260e4689e90cacada377b4))
* **budget:** clarify project forecast (S-04) ([#1080](https://github.com/ariefsaid/PMO/issues/1080)) ([1444573](https://github.com/ariefsaid/PMO/commit/144457350a7ccc18ac1798824246e789873debc1))
* **budget:** sole-operator exception to the second-activator rule ([#1050](https://github.com/ariefsaid/PMO/issues/1050)) ([#1052](https://github.com/ariefsaid/PMO/issues/1052)) ([c98b0f9](https://github.com/ariefsaid/PMO/commit/c98b0f9076b9d248cf5ea7e474d8acd5e9d47d7c))
* **dashboard:** role dashboards tell the truth before summarizing (S-03) ([#1066](https://github.com/ariefsaid/PMO/issues/1066)) ([ca0ea09](https://github.com/ariefsaid/PMO/commit/ca0ea09103036422646d2e31d73384ec029a9706))
* **finance:** make invoices easier to chase (S-05) ([#1054](https://github.com/ariefsaid/PMO/issues/1054)) ([6145fee](https://github.com/ariefsaid/PMO/commit/6145feee8cf85554fa0bd38ea294aa37f79cd0af))
* **fx:** clarify exchange-rate coverage (S-38) ([#1067](https://github.com/ariefsaid/PMO/issues/1067)) ([ff1f274](https://github.com/ariefsaid/PMO/commit/ff1f274f1109bb4ce59d492a955ee1e3c2d0ae16))
* **integrations:** review setup once, then only exceptions (S-08) ([#1078](https://github.com/ariefsaid/PMO/issues/1078)) ([8efba02](https://github.com/ariefsaid/PMO/commit/8efba02501a25025175f83e1a01eeda4020a7559))
* **invoices:** invoice detail supports collection and honest delivery (S-17) ([#1086](https://github.com/ariefsaid/PMO/issues/1086)) ([29fc483](https://github.com/ariefsaid/PMO/commit/29fc483e4b8fc16a3793919999af75ed9f3edc79))
* **project-detail:** one trustworthy money position (S-01) ([#1082](https://github.com/ariefsaid/PMO/issues/1082)) ([2ca6bfe](https://github.com/ariefsaid/PMO/commit/2ca6bfef8dbe258d891c3fb0cd9a772e8d9321b6))
* **projects:** trustworthy money on the projects list (S-02) ([#1085](https://github.com/ariefsaid/PMO/issues/1085)) ([8cae183](https://github.com/ariefsaid/PMO/commit/8cae183caa63996bdcff0ea0c2ba12e2a67aee6e))
* **receipts:** show every invoice a receipt settled (S-06) ([#1077](https://github.com/ariefsaid/PMO/issues/1077)) ([f991cc0](https://github.com/ariefsaid/PMO/commit/f991cc0630fc2cd17305be10d4720c04d25e598f))
* **statements:** B1 source foundations — single-flight sweep, account chart, ledger fields ([#897](https://github.com/ariefsaid/PMO/issues/897)) ([#1051](https://github.com/ariefsaid/PMO/issues/1051)) ([41b8f75](https://github.com/ariefsaid/PMO/commit/41b8f75058c0cbdba4da59c045a80d7f23299418))


### Bug Fixes

* **approvals:** one review queue, honest scope (S-18) ([#1064](https://github.com/ariefsaid/PMO/issues/1064)) ([fa44803](https://github.com/ariefsaid/PMO/commit/fa448039772f1998052f58ea9423609455087d7e))
* **dashboard:** one PM at-risk tile; dashboard journeys on the one-Actual seed (v0.22.0) ([#1096](https://github.com/ariefsaid/PMO/issues/1096)) ([f8bbff5](https://github.com/ariefsaid/PMO/commit/f8bbff5076ec288771749459b90aa7a086b326af))
* **e2e:** align approval journey and project contrast (v0.22.0 e2e) ([#1095](https://github.com/ariefsaid/PMO/issues/1095)) ([2396dca](https://github.com/ariefsaid/PMO/commit/2396dcabb1f71b46814a883c2d3caf1a90db22a9))
* **expenses:** clarify posting readiness (S-12) ([#1062](https://github.com/ariefsaid/PMO/issues/1062)) ([7bce28f](https://github.com/ariefsaid/PMO/commit/7bce28fd3637c0d9cbf71feed1b557b2e6c34553))
* **finance:** plain wording for project costs that ERP can't place yet ([#1045](https://github.com/ariefsaid/PMO/issues/1045)) ([#1047](https://github.com/ariefsaid/PMO/issues/1047)) ([cdf704e](https://github.com/ariefsaid/PMO/commit/cdf704e90a10fa3fad05c6f554216c328ad2e274))
* **integrations:** readiness first, honest status (S-07) ([#1075](https://github.com/ariefsaid/PMO/issues/1075)) ([a15042b](https://github.com/ariefsaid/PMO/commit/a15042bd4d74d3994f512bec3f5029e36a303131))
* **invoices:** show net before tax correctly for tax-inclusive invoices ([#1048](https://github.com/ariefsaid/PMO/issues/1048)) ([#1049](https://github.com/ariefsaid/PMO/issues/1049)) ([47988b8](https://github.com/ariefsaid/PMO/commit/47988b87449aa64e4780828b2cf4556f96898aab))
* **money:** one Actual, one currency rule and one at-risk rule on every surface (v0.22.0) ([#1091](https://github.com/ariefsaid/PMO/issues/1091)) ([b8c57e5](https://github.com/ariefsaid/PMO/commit/b8c57e578f2c8e7911746f975ee10354af4b07f5))
* **procurement:** put decision after evidence (S-20) ([#1079](https://github.com/ariefsaid/PMO/issues/1079)) ([d0d05fc](https://github.com/ariefsaid/PMO/commit/d0d05fc655334876f94759e5355b517a7aba7b0f))
* **project-detail:** compact identity; selected work owns the page (S-13) ([#1087](https://github.com/ariefsaid/PMO/issues/1087)) ([ae6ab20](https://github.com/ariefsaid/PMO/commit/ae6ab20872c5704eff0a5b87b24d30ebabd20701))
* **projects:** projects are recognisable before controls and filler (S-14) ([#1092](https://github.com/ariefsaid/PMO/issues/1092)) ([a77738e](https://github.com/ariefsaid/PMO/commit/a77738edffc4bb14d4438307e87d5376654ec53c))
* **reports:** management pack states period, currency and edit scope (S-34) ([#1084](https://github.com/ariefsaid/PMO/issues/1084)) ([0b326e5](https://github.com/ariefsaid/PMO/commit/0b326e5ddb7b4ef29a2260d89b9f93ab3be0f3df))
* **revenue:** label tax bases on project totals (S-37) ([#1061](https://github.com/ariefsaid/PMO/issues/1061)) ([1a0f3b3](https://github.com/ariefsaid/PMO/commit/1a0f3b377f40e24fdf01f5256abfd735161f44e8))
* **shell:** keep Approvals reachable from every screen (S-25) ([#1053](https://github.com/ariefsaid/PMO/issues/1053)) ([b8cbfba](https://github.com/ariefsaid/PMO/commit/b8cbfba0edc8a0db796e5d45a523e01490ba5aee))
* **tables:** row action menus stay above toasts; timesheet journeys follow S-28 (v0.22.0) ([#1097](https://github.com/ariefsaid/PMO/issues/1097)) ([af46610](https://github.com/ariefsaid/PMO/commit/af46610f68ea8a3af8d59a5828f17288b89f23e3))
* **timesheets:** clarify entry and review states (S-28) ([#1055](https://github.com/ariefsaid/PMO/issues/1055)) ([39f0a28](https://github.com/ariefsaid/PMO/commit/39f0a285b99b695256ac9e8c7f149e8ebbade676))

## [0.21.0](https://github.com/ariefsaid/PMO/compare/v0.20.0...v0.21.0) (2026-10-16)


### Features

* **budget:** ERPNext v16 budget push — one Budget per account ([#1033](https://github.com/ariefsaid/PMO/issues/1033)) ([#1040](https://github.com/ariefsaid/PMO/issues/1040)) ([0d4390a](https://github.com/ariefsaid/PMO/commit/0d4390a44f2d00ad1aac23f120633cf6566da175))
* **m365:** document linking phase 1 — schema, custody reads, verification ([#1020](https://github.com/ariefsaid/PMO/issues/1020)) ([#1037](https://github.com/ariefsaid/PMO/issues/1037)) ([0f65efc](https://github.com/ariefsaid/PMO/commit/0f65efc3e0460078813ea5ef117731917a9536cb))

## [0.20.0](https://github.com/ariefsaid/PMO/compare/v0.19.0...v0.20.0) (2026-10-15)


### Features

* **finance:** revenue and cost per project — adopt with project, assign the rest, one finance view ([#1008](https://github.com/ariefsaid/PMO/issues/1008)) ([#1028](https://github.com/ariefsaid/PMO/issues/1028)) ([53fe969](https://github.com/ariefsaid/PMO/commit/53fe969142235ba1b16260f8ba4dad746daee452))
* **fx:** JISDOR exchange-rate table and rupiah equivalents ([#1012](https://github.com/ariefsaid/PMO/issues/1012)) ([#1026](https://github.com/ariefsaid/PMO/issues/1026)) ([fd54799](https://github.com/ariefsaid/PMO/commit/fd5479977accac6037df569452476e5c01d42f3c))


### Bug Fixes

* clear the release PR's four chromium e2e failures ([#1029](https://github.com/ariefsaid/PMO/issues/1029)) ([#1031](https://github.com/ariefsaid/PMO/issues/1031)) ([1ff8257](https://github.com/ariefsaid/PMO/commit/1ff82577723da4fb2f80c6a22a76c35434cb0c77))
* **erpnext:** Material Request sweep stops requesting a nonexistent total field ([#1034](https://github.com/ariefsaid/PMO/issues/1034)) ([99618b5](https://github.com/ariefsaid/PMO/commit/99618b5386dcaa768a5c2f156fd3cb0c75a44d3f))

## [0.19.0](https://github.com/ariefsaid/PMO/compare/v0.18.0...v0.19.0) (2026-10-14)


### Features

* **i18n:** Bahasa on the dashboards, approvals tile and sales-invoice noun (UXS-006 A1, [#1011](https://github.com/ariefsaid/PMO/issues/1011)) ([#1021](https://github.com/ariefsaid/PMO/issues/1021)) ([4e3ed64](https://github.com/ariefsaid/PMO/commit/4e3ed641271a3ef0e9dd5612cc9444b671e72492))
* **ux:** phases — one visible noun, form guidance, project identity on calendar phases (UXS-034/035) ([#1015](https://github.com/ariefsaid/PMO/issues/1015)) ([f1aef58](https://github.com/ariefsaid/PMO/commit/f1aef588cb10bf58acf2c0e59742bc2be8c57314))
* **ux:** tax evidence carries recognizable invoice and project labels (UXS-031) ([#1022](https://github.com/ariefsaid/PMO/issues/1022)) ([50d12a5](https://github.com/ariefsaid/PMO/commit/50d12a5cb8e7ecb781cf9ee414f5042418ca5539))


### Bug Fixes

* **dashboard:** Executive at-risk count matches the Projects at-risk list; KPI help reachable ([#1009](https://github.com/ariefsaid/PMO/issues/1009)) ([00ea5f1](https://github.com/ariefsaid/PMO/commit/00ea5f1273bd2e1d905095b26dcfa69813879ee6))
* **erpnext:** a linked Customer/Supplier rename reaches PMO ([#1005](https://github.com/ariefsaid/PMO/issues/1005)) ([6071121](https://github.com/ariefsaid/PMO/commit/6071121067075c1f7d2f675a4b89e38dbb44ab90))
* **import:** failed rows say why, not only "Update failed" ([#996](https://github.com/ariefsaid/PMO/issues/996)) ([356948e](https://github.com/ariefsaid/PMO/commit/356948ed69a69396414f52f986668e65e86e9b39))
* **invoices:** record page follow-ups — ERP lines note, status URL validation, Bahasa verb ([#1010](https://github.com/ariefsaid/PMO/issues/1010)) ([ae37309](https://github.com/ariefsaid/PMO/commit/ae373094aeb4906590e6551ebcf75d4568c9720f))
* **m365:** admin-consent URL carries the required scope ([#1014](https://github.com/ariefsaid/PMO/issues/1014)) ([#1019](https://github.com/ariefsaid/PMO/issues/1019)) ([e7675ad](https://github.com/ariefsaid/PMO/commit/e7675ad3dba8b07d0418e2546983286aea1953c8))
* **ui:** row-actions shadow only when content scrolls under it; header rule uses the border token ([#1013](https://github.com/ariefsaid/PMO/issues/1013)) ([a79ee8a](https://github.com/ariefsaid/PMO/commit/a79ee8af45611b38a404d2d2a66840095ecd500e))

## [0.18.0](https://github.com/ariefsaid/PMO/compare/v0.17.0...v0.18.0) (2026-10-13)


### Features

* **revenue:** PPN invoice correction via cancel + re-issue; unlock project VAT once all invoices are cancelled ([#956](https://github.com/ariefsaid/PMO/issues/956)) ([#973](https://github.com/ariefsaid/PMO/issues/973)) ([1111629](https://github.com/ariefsaid/PMO/commit/1111629d2f6cfb6336b5879a1a255f115280cc1d))
* **ui:** compact clear queues, actionable PM rows, flat preferences card (UI polish slices 5+6) ([#974](https://github.com/ariefsaid/PMO/issues/974)) ([8873aab](https://github.com/ariefsaid/PMO/commit/8873aab006c9bbd1e1f35077e3dac65b1a46847e))
* **ui:** one Lucide icon family + recognizable rail; fix page side-scroll (UI polish slice 1) ([#972](https://github.com/ariefsaid/PMO/issues/972)) ([20ffa6a](https://github.com/ariefsaid/PMO/commit/20ffa6aa0637a6fa32eca283d9bf9d4978d66669))
* **ui:** procurement scan columns, readable approval identities, phone record headers (UI polish slice 4) ([#977](https://github.com/ariefsaid/PMO/issues/977)) ([cfaf538](https://github.com/ariefsaid/PMO/commit/cfaf53869b553163f4a005c40a68f03e152bf15b))
* **ui:** project detail — compact context, tab work in the first viewport (UI polish slice 3) ([#975](https://github.com/ariefsaid/PMO/issues/975)) ([4057531](https://github.com/ariefsaid/PMO/commit/4057531cfbfe553dea04288eb0d4f42ee7923428))
* **ui:** readable project lists — identity first, collapsed classification filters (UI polish slice 2) ([#976](https://github.com/ariefsaid/PMO/issues/976)) ([faca448](https://github.com/ariefsaid/PMO/commit/faca448e74b9da359ee34e4ebfbc75c6fa6067db))
* **ux:** accountable meeting follow-ups and a focused My Tasks queue (UX Discover slice 5) ([#984](https://github.com/ariefsaid/PMO/issues/984)) ([93505a2](https://github.com/ariefsaid/PMO/commit/93505a202cabb029964d1bee66ce6131156fb947))
* **ux:** addressable invoice records and a direct handoff to billed drafts (UX Discover slice 4) ([#990](https://github.com/ariefsaid/PMO/issues/990)) ([ae3984f](https://github.com/ariefsaid/PMO/commit/ae3984f9cc2a79f8e2030fbda09089a97bceaf09))
* **ux:** dashboards that lead to the work — risk/budget links, realized-margin help, readable tooltips (UX Discover slice 7) ([#987](https://github.com/ariefsaid/PMO/issues/987)) ([1e42cd3](https://github.com/ariefsaid/PMO/commit/1e42cd3844bbc29d5fbc29fef604bd34b2273da9))
* **ux:** discoverable homes and one shell vocabulary — PM My Tasks, Vendors doorway, localized nav (UX Discover slice 6) ([#989](https://github.com/ariefsaid/PMO/issues/989)) ([57e9afb](https://github.com/ariefsaid/PMO/commit/57e9afba2243af43871f579a6b8462780022b1e3))
* **ux:** one pending approvals population, pending before history, receipt preview in the inbox (UX Discover slice 1) ([#988](https://github.com/ariefsaid/PMO/issues/988)) ([507103c](https://github.com/ariefsaid/PMO/commit/507103cce3d0a8876ad667f7626e43c8cb14cbb9))
* **ux:** prerequisites before dead ends — vendor recovery, work-order issue gate, localized VAT refusals (UX Discover slice 3) ([#985](https://github.com/ariefsaid/PMO/issues/985)) ([cca8514](https://github.com/ariefsaid/PMO/commit/cca851469d63f378af3644c4416df21919c55335))
* **ux:** reachable phone week completion and localized timesheet grid (UX Discover slice 8) ([#992](https://github.com/ariefsaid/PMO/issues/992)) ([4bd1c1c](https://github.com/ariefsaid/PMO/commit/4bd1c1c8dfbe992d50bbc299c47845dc4871f002))
* **ux:** receipt preview, decision context in expense confirmations, dialog-safe warnings (UX Discover slice 2) ([#983](https://github.com/ariefsaid/PMO/issues/983)) ([2c04834](https://github.com/ariefsaid/PMO/commit/2c048348092209ef74fe92245ca041105de61e40))


### Bug Fixes

* **erpnext:** sweep polls non-submittable doctypes (Customer, Supplier, Employee) ([#999](https://github.com/ariefsaid/PMO/issues/999)) ([709e7ce](https://github.com/ariefsaid/PMO/commit/709e7cee6904a145f19f0be60a14702266a54c21))
* **procurement:** one amount basis, payable settlement, quote selection through comparison ([#979](https://github.com/ariefsaid/PMO/issues/979)) ([#982](https://github.com/ariefsaid/PMO/issues/982)) ([be747b4](https://github.com/ariefsaid/PMO/commit/be747b420d089691c8dc66ad75447c2223ed687f))
* **procurement:** withholding slip follow-ups — history labels, case scroll, pinned polish ([#961](https://github.com/ariefsaid/PMO/issues/961)) ([#970](https://github.com/ariefsaid/PMO/issues/970)) ([48050d0](https://github.com/ariefsaid/PMO/commit/48050d04739ab98018f1ec7fcdafd77941909674))
* **projects:** phone list bleed; journeys follow the compact project header ([#995](https://github.com/ariefsaid/PMO/issues/995)) ([f41884d](https://github.com/ariefsaid/PMO/commit/f41884dece68fd0a280c8b38a38a78cb0dbc4766))
* **shell:** My Tasks link name and phone drawer focus return ([#993](https://github.com/ariefsaid/PMO/issues/993)) ([de7ac6d](https://github.com/ariefsaid/PMO/commit/de7ac6dcffc4b115299ce3e8b8105cb8586545dd))
* **ui:** classification filters keep typed location when another filter changes ([#1000](https://github.com/ariefsaid/PMO/issues/1000)) ([b501c2b](https://github.com/ariefsaid/PMO/commit/b501c2b12142006c4967272aee66da04535c2eb4))
* **ui:** toasts clear mobile action bars; modal save errors stay inline ([#953](https://github.com/ariefsaid/PMO/issues/953)) ([#969](https://github.com/ariefsaid/PMO/issues/969)) ([0ffd1f9](https://github.com/ariefsaid/PMO/commit/0ffd1f9f2e0832e7a21cb85107667a48c6dbfa06))

## [0.17.0](https://github.com/ariefsaid/PMO/compare/v0.16.0...v0.17.0) (2026-10-09)


### Features

* **history:** change history for PMO-owned facts on invoices and vendor bills ([#920](https://github.com/ariefsaid/PMO/issues/920)) ([#949](https://github.com/ariefsaid/PMO/issues/949)) ([89b445f](https://github.com/ariefsaid/PMO/commit/89b445fffb513cc2f1155f6ce1937c14a70bb87f))
* **history:** procurement documents under their procurement; translated admin audit lines ([#878](https://github.com/ariefsaid/PMO/issues/878), [#880](https://github.com/ariefsaid/PMO/issues/880)) ([#945](https://github.com/ariefsaid/PMO/issues/945)) ([1b5a915](https://github.com/ariefsaid/PMO/commit/1b5a915f5b7dfcfa70efdb288ea0f5c741762418))
* **procurement:** pay a vendor bill from PMO on an ERP-connected org ([#910](https://github.com/ariefsaid/PMO/issues/910)) ([#939](https://github.com/ariefsaid/PMO/issues/939)) ([284e88e](https://github.com/ariefsaid/PMO/commit/284e88e02563305f73132e8e15cadee3f336a6e0))
* **procurement:** record the vendor's withholding slip (bukti potong) against vendor bills ([#911](https://github.com/ariefsaid/PMO/issues/911)) ([#958](https://github.com/ariefsaid/PMO/issues/958)) ([6815559](https://github.com/ariefsaid/PMO/commit/681555936233ea28a8b4d28b9966f740469feab8))
* **revenue:** customer invoices and receipts for orgs without an ERP ([#784](https://github.com/ariefsaid/PMO/issues/784)) ([#936](https://github.com/ariefsaid/PMO/issues/936)) ([924ba32](https://github.com/ariefsaid/PMO/commit/924ba32f412cfbc34a41e6a1a9575cbb538b74ec))
* **revenue:** invoice a work order directly when the org has no ERP ([#913](https://github.com/ariefsaid/PMO/issues/913)) ([#948](https://github.com/ariefsaid/PMO/issues/948)) ([75f1e9b](https://github.com/ariefsaid/PMO/commit/75f1e9b00c068efa5a9be47bbfe65a12c553ed76))


### Bug Fixes

* **a11y:** arrow-key tab switching keeps focus in the tab bar ([#879](https://github.com/ariefsaid/PMO/issues/879)) ([#950](https://github.com/ariefsaid/PMO/issues/950)) ([fffa5cb](https://github.com/ariefsaid/PMO/commit/fffa5cb572f2f38f1b2b638855b77d91cd2fc0ab))
* **budget:** activation refuses anyone who edited the version (DD-BUDGET-7) ([#957](https://github.com/ariefsaid/PMO/issues/957)) ([83cf104](https://github.com/ariefsaid/PMO/commit/83cf1047465a7b1461d055059f82e7064487f1c6))
* **e2e:** assert the visible toast, not its screen-reader copy ([#963](https://github.com/ariefsaid/PMO/issues/963)) ([e316880](https://github.com/ariefsaid/PMO/commit/e316880b9eac1a649971e0f61ac9c340deda699e))
* **erpnext:** bound the sweep's work per invocation ([#916](https://github.com/ariefsaid/PMO/issues/916)) ([#940](https://github.com/ariefsaid/PMO/issues/940)) ([8592054](https://github.com/ariefsaid/PMO/commit/85920547f5b3f5a25effa14a105751c09dba69e2))
* **erpnext:** release-review fixes — payment recovery, sweep fairness, ledger catch-up, DNS fallback, employee ledger scope ([#955](https://github.com/ariefsaid/PMO/issues/955)) ([9840a15](https://github.com/ariefsaid/PMO/commit/9840a15b4e06dba14ef13a9eddeef536805ae025))
* **erpnext:** the sweep adopts each new Supplier/Customer under its own Supplier:/Customer:&lt;docname&gt; id ([#935](https://github.com/ariefsaid/PMO/issues/935)) ([#938](https://github.com/ariefsaid/PMO/issues/938)) ([f3c41c5](https://github.com/ariefsaid/PMO/commit/f3c41c5417083d3f5216f15e7f68adca54d6a05d))
* **erp:** the ERP client bounds the whole response ([#918](https://github.com/ariefsaid/PMO/issues/918)) ([#947](https://github.com/ariefsaid/PMO/issues/947)) ([96289d6](https://github.com/ariefsaid/PMO/commit/96289d6e1d2e8e58aca0fd0f3f19a6b517158154))
* **procurement:** withholding slip screens — critique fixes ([#911](https://github.com/ariefsaid/PMO/issues/911) polish) ([#962](https://github.com/ariefsaid/PMO/issues/962)) ([ae514d6](https://github.com/ariefsaid/PMO/commit/ae514d639ff4d3a4bb8891b9412a5fb2ededd6a1))
* **ui:** Bahasa for the form 'Nothing was saved' line, shell updates deferred out of render, withdrawn-claim headline ([#891](https://github.com/ariefsaid/PMO/issues/891)) ([#943](https://github.com/ariefsaid/PMO/issues/943)) ([4ad3b16](https://github.com/ariefsaid/PMO/commit/4ad3b169294a1b254446964fa49b30c6783f8594))
* **ui:** release-review fixes — list search focus, approver payment gate, id-ID prefill, copy ([#954](https://github.com/ariefsaid/PMO/issues/954)) ([04c6d78](https://github.com/ariefsaid/PMO/commit/04c6d78883886d089a9cb385d895f22b50bd3145))
* **ui:** row actions stay visible when a wide table scrolls sideways ([#925](https://github.com/ariefsaid/PMO/issues/925)) ([#937](https://github.com/ariefsaid/PMO/issues/937)) ([5584a12](https://github.com/ariefsaid/PMO/commit/5584a125cf8e7866f56888a7f94c7084c1a0d815))
* **ui:** toasts a user can read, announced reliably ([#926](https://github.com/ariefsaid/PMO/issues/926)) ([#952](https://github.com/ariefsaid/PMO/issues/952)) ([2df6318](https://github.com/ariefsaid/PMO/commit/2df6318f5157646ea26b5c5960c41957019777c5))

## [0.16.0](https://github.com/ariefsaid/PMO/compare/v0.15.0...v0.16.0) (2026-10-07)


### Features

* **billing:** bill by work order — invoiced / paid / still to invoice per client PO ([#785](https://github.com/ariefsaid/PMO/issues/785), [#786](https://github.com/ariefsaid/PMO/issues/786)) ([#892](https://github.com/ariefsaid/PMO/issues/892)) ([07a9da2](https://github.com/ariefsaid/PMO/commit/07a9da2fb4588a010ccce633a95e3c0ee505d85a))
* **expenses:** expense claims and cash advances post to ERPNext — journal and payment entries ([#775](https://github.com/ariefsaid/PMO/issues/775) phase B) ([#924](https://github.com/ariefsaid/PMO/issues/924)) ([ff37f07](https://github.com/ariefsaid/PMO/commit/ff37f07bc42648702bda47483b5f6737d298c5ef))
* **procurement:** vendor tax defaults with entered VAT/PPh amounts ([#876](https://github.com/ariefsaid/PMO/issues/876), slice 2) ([#929](https://github.com/ariefsaid/PMO/issues/929)) ([f32d35b](https://github.com/ariefsaid/PMO/commit/f32d35bc4061767aaea321d87419ad4e3075e32c))
* **procurement:** vendor withholding (PPh) on ERP-owned bills ([#876](https://github.com/ariefsaid/PMO/issues/876), slice 1) ([#917](https://github.com/ariefsaid/PMO/issues/917)) ([0089275](https://github.com/ariefsaid/PMO/commit/00892751f7b0e477fc892c4a5d2cf7ae86f456c8))
* **revenue:** download the ERP's invoice PDF from PMO ([#912](https://github.com/ariefsaid/PMO/issues/912)) ([#930](https://github.com/ariefsaid/PMO/issues/930)) ([80b7cb4](https://github.com/ariefsaid/PMO/commit/80b7cb42e53def6b94c8890797163a941f802780))
* **revenue:** e-Faktur number and date on invoices and vendor bills ([#893](https://github.com/ariefsaid/PMO/issues/893)) ([#928](https://github.com/ariefsaid/PMO/issues/928)) ([ce2ea93](https://github.com/ariefsaid/PMO/commit/ce2ea93ccb7fe4d972aa7d9df47c04b8184b2626))


### Bug Fixes

* **budget:** a budget version is activated by someone other than its drafter ([#922](https://github.com/ariefsaid/PMO/issues/922)) ([#927](https://github.com/ariefsaid/PMO/issues/927)) ([1f871da](https://github.com/ariefsaid/PMO/commit/1f871da417b1c6c260eb5a4cfb9f536f47184686))
* **erpnext:** ledger mirror keeps syncing and reflects cancellations ([#901](https://github.com/ariefsaid/PMO/issues/901)) ([#931](https://github.com/ariefsaid/PMO/issues/931)) ([cd41ff6](https://github.com/ariefsaid/PMO/commit/cd41ff6705fa2612bc62d25b1d7d38a014ab4f92))
* **security:** tighten four role gates to match existing rulings ([#909](https://github.com/ariefsaid/PMO/issues/909)) ([#914](https://github.com/ariefsaid/PMO/issues/914)) ([efc8e8a](https://github.com/ariefsaid/PMO/commit/efc8e8a70e07ec7878783a6f1cad1a1c7a937444))

## [0.15.0](https://github.com/ariefsaid/PMO/compare/v0.14.0...v0.15.0) (2026-10-06)


### Features

* **assistant:** draft a customer invoice for confirmation ([#787](https://github.com/ariefsaid/PMO/issues/787) slice B) ([#861](https://github.com/ariefsaid/PMO/issues/861)) ([ee1bd04](https://github.com/ariefsaid/PMO/commit/ee1bd04ef0a830b3e782334557dbd7e070fc24d8))
* **assistant:** what's overdue across my projects ([#787](https://github.com/ariefsaid/PMO/issues/787) slice A) ([#849](https://github.com/ariefsaid/PMO/issues/849)) ([2c5a8d8](https://github.com/ariefsaid/PMO/commit/2c5a8d861c51a86e621e85e5d56bc00165f0531d))
* **billing:** send VAT rows on sales invoices, gated by a per-project flag ([#856](https://github.com/ariefsaid/PMO/issues/856)) ([#862](https://github.com/ariefsaid/PMO/issues/862)) ([f020c3a](https://github.com/ariefsaid/PMO/commit/f020c3a6afcf4d35ac9e297bad4f4fc03b7cf60b))
* **budget:** several ERP accounts per budget category, one push account ([#768](https://github.com/ariefsaid/PMO/issues/768)) ([#848](https://github.com/ariefsaid/PMO/issues/848)) ([a2f0f60](https://github.com/ariefsaid/PMO/commit/a2f0f6062acfa0557b1557872a568e622feef35f))
* comments on projects and tasks with mentions ([#790](https://github.com/ariefsaid/PMO/issues/790)) ([#853](https://github.com/ariefsaid/PMO/issues/853)) ([4de113b](https://github.com/ariefsaid/PMO/commit/4de113beb05b2edf4532dc0fb247def93fc84525))
* expense claims and cash advances, phase A ([#775](https://github.com/ariefsaid/PMO/issues/775)) ([#854](https://github.com/ariefsaid/PMO/issues/854)) ([5887584](https://github.com/ariefsaid/PMO/commit/5887584659a10eb25c3d6532ce185e102ae409a7))
* **history:** History tab on project and procurement, history card on company and contact ([#719](https://github.com/ariefsaid/PMO/issues/719)) ([#884](https://github.com/ariefsaid/PMO/issues/884)) ([93674e5](https://github.com/ariefsaid/PMO/commit/93674e590848f3fbfcb099e6c2e7cd0c5dc3feb0))
* **history:** record change history — data layer ([#719](https://github.com/ariefsaid/PMO/issues/719)) ([#872](https://github.com/ariefsaid/PMO/issues/872)) ([eea43dc](https://github.com/ariefsaid/PMO/commit/eea43dcd211935beea5f3a6437222a42927c4d1a))
* **meetings:** BlockNote minutes editor with action-item blocks ([#805](https://github.com/ariefsaid/PMO/issues/805)) ([#863](https://github.com/ariefsaid/PMO/issues/863)) ([c77ad70](https://github.com/ariefsaid/PMO/commit/c77ad70962ef66029828c53e02a220bc7c072462))
* **meetings:** warn before leaving unsaved minutes ([#864](https://github.com/ariefsaid/PMO/issues/864)) ([#882](https://github.com/ariefsaid/PMO/issues/882)) ([0a0c386](https://github.com/ariefsaid/PMO/commit/0a0c3869553e5f79901394f633ffa308956447c4))
* **notifications:** keyset-paged inbox with load more ([#843](https://github.com/ariefsaid/PMO/issues/843), first slice) ([#868](https://github.com/ariefsaid/PMO/issues/868)) ([76c4412](https://github.com/ariefsaid/PMO/commit/76c441253b8f28b466dbba7a3e086736c25d4213))
* **procurement:** choose the ERPNext purchase tax template on a flipped org ([#520](https://github.com/ariefsaid/PMO/issues/520)) ([#875](https://github.com/ariefsaid/PMO/issues/875)) ([bf5b96c](https://github.com/ariefsaid/PMO/commit/bf5b96caa460f6af4ba123fa9adfcf310e120b6f))
* progress assessment, evidence-backed billing claims, down payment ([#766](https://github.com/ariefsaid/PMO/issues/766)) ([#855](https://github.com/ariefsaid/PMO/issues/855)) ([7ea285e](https://github.com/ariefsaid/PMO/commit/7ea285ed9d1a99aedcf5308233555c2f1c312d3e))


### Bug Fixes

* **alerts:** Telegram alert drain groups, cools down and stamps per organization ([#629](https://github.com/ariefsaid/PMO/issues/629)) ([#877](https://github.com/ariefsaid/PMO/issues/877)) ([982f8d7](https://github.com/ariefsaid/PMO/commit/982f8d7a60e0b8ef7cf7fd070119e91848d9e30f))
* **billing:** check an ordinary invoice's currency against the customer's ERPNext billing currency ([#866](https://github.com/ariefsaid/PMO/issues/866)) ([#870](https://github.com/ariefsaid/PMO/issues/870)) ([6e4167b](https://github.com/ariefsaid/PMO/commit/6e4167baaf47bf985bbfd8404d7400823fee9fde))
* **billing:** replay-safe invoice recovery, claim currency check, onboarding wiring, case-safe VAT lock ([#858](https://github.com/ariefsaid/PMO/issues/858)) ([#865](https://github.com/ariefsaid/PMO/issues/865)) ([0521180](https://github.com/ariefsaid/PMO/commit/05211804521142066fa64861ebb8f2cab35959a2))
* **erpnext:** a refused contact no longer stalls later contact sync ([#828](https://github.com/ariefsaid/PMO/issues/828)) ([#846](https://github.com/ariefsaid/PMO/issues/846)) ([7b6a43b](https://github.com/ariefsaid/PMO/commit/7b6a43bb51296abb5f847bbfac5e8f6f3751316f))
* **erpnext:** onboarding uses the shared credential resolver and kill switch; miss logs carry codes only ([#654](https://github.com/ariefsaid/PMO/issues/654) items 1, 3) ([#873](https://github.com/ariefsaid/PMO/issues/873)) ([0e243b2](https://github.com/ariefsaid/PMO/commit/0e243b2c9293773ff53bd0b445bc1b6a81435f4d))
* **projects:** archived projects leave the Sales Pipeline and default project lists ([#883](https://github.com/ariefsaid/PMO/issues/883)) ([#887](https://github.com/ariefsaid/PMO/issues/887)) ([2b63ca8](https://github.com/ariefsaid/PMO/commit/2b63ca8fc96d081ca509631aed46a1696991954a))
* **projects:** show project number/client code values without label prefix in list cell ([#838](https://github.com/ariefsaid/PMO/issues/838)) ([#859](https://github.com/ariefsaid/PMO/issues/859)) ([1fbe4bb](https://github.com/ariefsaid/PMO/commit/1fbe4bbd37b44b38b2f2ac3f6df932fdbc4bdf67))
* **reports:** Revenue by Project sums net of tax, one total per currency ([#831](https://github.com/ariefsaid/PMO/issues/831)) ([#860](https://github.com/ariefsaid/PMO/issues/860)) ([0015f2c](https://github.com/ariefsaid/PMO/commit/0015f2c15d057930836f9a47d64875edecbaf31c))


### Performance

* cache hashed assets a year; timeouts on outbound calls ([#839](https://github.com/ariefsaid/PMO/issues/839), [#841](https://github.com/ariefsaid/PMO/issues/841)) ([#850](https://github.com/ariefsaid/PMO/issues/850)) ([08a98b2](https://github.com/ariefsaid/PMO/commit/08a98b2cb32527068150d74770b758e8e643b291))
* stop loading whole tables the screen doesn't show ([#840](https://github.com/ariefsaid/PMO/issues/840)) ([#851](https://github.com/ariefsaid/PMO/issues/851)) ([60df8d3](https://github.com/ariefsaid/PMO/commit/60df8d304b1e134fe20b95999ca7166ed6279cc2))

## [0.14.0](https://github.com/ariefsaid/PMO/compare/v0.13.0...v0.14.0) (2026-10-06)


### Features

* add fixed special expenses budget category ([#816](https://github.com/ariefsaid/PMO/issues/816)) ([29a39ff](https://github.com/ariefsaid/PMO/commit/29a39ff6feb66d5c3b6036a9eec8b6f6b2ea0979))
* carry purchase project and vendor references ([#764](https://github.com/ariefsaid/PMO/issues/764)) ([80a08d1](https://github.com/ariefsaid/PMO/commit/80a08d10e702b82e6b08722271aa667562192071))
* **cli:** pmo load — a client's starting data through the app's own write paths ([#796](https://github.com/ariefsaid/PMO/issues/796)) ([#827](https://github.com/ariefsaid/PMO/issues/827)) ([c7c44cd](https://github.com/ariefsaid/PMO/commit/c7c44cdcc96e394305988cd2a55154acb846a24e))
* **companies:** support short display names ([#807](https://github.com/ariefsaid/PMO/issues/807)) ([ebe319d](https://github.com/ariefsaid/PMO/commit/ebe319d7556f91f75abe16f0de924b7e21a9c6c1))
* **erpnext:** send sales invoice client purchase references ([#809](https://github.com/ariefsaid/PMO/issues/809)) ([f27e026](https://github.com/ariefsaid/PMO/commit/f27e0269690c751f35d1a17ef645f6ef95f51600))
* Monthly management pack ([#765](https://github.com/ariefsaid/PMO/issues/765)) ([#835](https://github.com/ariefsaid/PMO/issues/835)) ([ff70dd7](https://github.com/ariefsaid/PMO/commit/ff70dd765b9934286e7ae1c0b8e7ff127d2e6fa2))
* **notifications:** tell the next person when something waits on them ([#788](https://github.com/ariefsaid/PMO/issues/788)) ([#825](https://github.com/ariefsaid/PMO/issues/825)) ([808cac8](https://github.com/ariefsaid/PMO/commit/808cac8b00cfc3ff12d49b490d8a67acdcfe4516))
* **pipeline:** Declined outcome, separate from a lost tender ([#774](https://github.com/ariefsaid/PMO/issues/774)) ([#824](https://github.com/ariefsaid/PMO/issues/824)) ([25f41a5](https://github.com/ariefsaid/PMO/commit/25f41a51fc381aa64ba9110c31fbd68597071e6e))
* **procurement:** external reference number on PR, PO and vendor invoice ([#769](https://github.com/ariefsaid/PMO/issues/769)) ([#826](https://github.com/ariefsaid/PMO/issues/826)) ([e5cbc04](https://github.com/ariefsaid/PMO/commit/e5cbc0404c875a529303049719c55b9f1937ecf0))
* **procurement:** route approvals by budget ([#803](https://github.com/ariefsaid/PMO/issues/803)) ([#832](https://github.com/ariefsaid/PMO/issues/832)) ([e5d0d6a](https://github.com/ariefsaid/PMO/commit/e5d0d6a44dadb752011db23baf39d6d287f7e48e))
* **projects:** classification tags — service line, sector, tender/direct, location, bidding entity ([#770](https://github.com/ariefsaid/PMO/issues/770)) ([#823](https://github.com/ariefsaid/PMO/issues/823)) ([93530c3](https://github.com/ariefsaid/PMO/commit/93530c33eb1bbb8c8a7e8ca610868280bc0d5fdc))
* **projects:** record the end customer alongside the client ([#758](https://github.com/ariefsaid/PMO/issues/758)) ([#761](https://github.com/ariefsaid/PMO/issues/761)) ([52e0514](https://github.com/ariefsaid/PMO/commit/52e051437ff82169994ed68e804d9e9bb34b356c))
* Receipt due date follows the client's receipt date ([#767](https://github.com/ariefsaid/PMO/issues/767)) ([#834](https://github.com/ariefsaid/PMO/issues/834)) ([aa33b40](https://github.com/ariefsaid/PMO/commit/aa33b40fc47a15357f993342df5bec761d6491c9))
* record income tax withheld on client receipts ([#762](https://github.com/ariefsaid/PMO/issues/762)) ([#815](https://github.com/ariefsaid/PMO/issues/815)) ([96f8127](https://github.com/ariefsaid/PMO/commit/96f812730a12aa260599812c73f1036a8e2be991))
* select ERP items and describe invoice lines ([#763](https://github.com/ariefsaid/PMO/issues/763)) ([#813](https://github.com/ariefsaid/PMO/issues/813)) ([fe177f5](https://github.com/ariefsaid/PMO/commit/fe177f502bd7ff09618c3be1d8895b03aa628736))
* **tax:** support exact reduced tax bases ([#811](https://github.com/ariefsaid/PMO/issues/811)) ([10d074b](https://github.com/ariefsaid/PMO/commit/10d074b4b441fed3f09bf838522c72ce1d39e3f3))
* translate budget and finance screens to Bahasa ([#789](https://github.com/ariefsaid/PMO/issues/789)) ([#817](https://github.com/ariefsaid/PMO/issues/817)) ([34ab65a](https://github.com/ariefsaid/PMO/commit/34ab65a0c744fcf590fc2f4bcffebb880e6f4a8f))


### Bug Fixes

* **erpnext:** key onboarded parties by the ERPNext ID, not the display name ([#760](https://github.com/ariefsaid/PMO/issues/760)) ([#782](https://github.com/ariefsaid/PMO/issues/782)) ([2224ec6](https://github.com/ariefsaid/PMO/commit/2224ec6a4fa992099ad07ea6b047f31d5f0b4e9e))
* **features:** let operators entitle an org to the revenue section ([#778](https://github.com/ariefsaid/PMO/issues/778)) ([3690810](https://github.com/ariefsaid/PMO/commit/369081039c0bbcecef67a199936dc31bbfaadcc3))
* **finance:** show customer names, Finance breadcrumbs and locale dates ([#781](https://github.com/ariefsaid/PMO/issues/781)) ([#799](https://github.com/ariefsaid/PMO/issues/799)) ([c20add2](https://github.com/ariefsaid/PMO/commit/c20add21cd23066a6835938409b53081fb648fc5))
* match adopted ERP parties by tax identity ([#814](https://github.com/ariefsaid/PMO/issues/814)) ([2ab0b62](https://github.com/ariefsaid/PMO/commit/2ab0b629dec104b0de11965496522f00ae83097a))
* project table width and initials contrast ([#776](https://github.com/ariefsaid/PMO/issues/776), [#777](https://github.com/ariefsaid/PMO/issues/777)) ([538e7cc](https://github.com/ariefsaid/PMO/commit/538e7cccbb82c2c6274456990655e7135d057d12))
* **reports:** preserve export dates and revenue currency ([#808](https://github.com/ariefsaid/PMO/issues/808)) ([95a744a](https://github.com/ariefsaid/PMO/commit/95a744ad3d033d20f2428149284bee62145826f7))
* six release journeys — keep status/name in ERP-pending toasts, item picker follows domain ownership, Project setup breadcrumb, Projects table width ([#837](https://github.com/ariefsaid/PMO/issues/837)) ([526a566](https://github.com/ariefsaid/PMO/commit/526a566628b2f1480f722e3199295e547a6156ec))

## [0.13.0](https://github.com/ariefsaid/PMO/compare/v0.12.0...v0.13.0) (2026-09-30)


### Features

* enterprise UI/UX readiness milestone, follow-up batch, and CI as the full-suite gate ([37380e1](https://github.com/ariefsaid/PMO/commit/37380e17d0cf42454c365c9a9ffbf930192ee764))


### Bug Fixes

* **ui:** five rendered-check findings — dark error headline and selected stage contrast, projects table page scroll, Bahasa procurement board and sales funnel labels ([#741](https://github.com/ariefsaid/PMO/issues/741)) ([6303728](https://github.com/ariefsaid/PMO/commit/6303728559c4af0548b497c64c6e0e2d044dce61))

## [0.12.0](https://github.com/ariefsaid/PMO/compare/v0.11.1...v0.12.0) (2026-09-25)


### Features

* scope role preview to demo admins and add profile language choice ([bbe1ca5](https://github.com/ariefsaid/PMO/commit/bbe1ca5ab685fe0f5de45d2c47ee46e88da822a3))

## [0.11.1](https://github.com/ariefsaid/PMO/compare/v0.11.0...v0.11.1) (2026-09-23)


### Bug Fixes

* stabilize compact currency and finance lists ([#666](https://github.com/ariefsaid/PMO/issues/666)) ([f0fe123](https://github.com/ariefsaid/PMO/commit/f0fe123ff585c05a2a8d46e24f6fac3d79211d27))

## [0.11.0](https://github.com/ariefsaid/PMO/compare/v0.10.1...v0.11.0) (2026-09-15)


### Features

* **erpnext:** Company selection activates the binding — site_url at connect, handshake {15,16}, set-once activated_at ([#650](https://github.com/ariefsaid/PMO/issues/650)) ([#657](https://github.com/ariefsaid/PMO/issues/657)) ([03a8cb6](https://github.com/ariefsaid/PMO/commit/03a8cb6d92cf650c6b8da6ef49dd1f2452bf6d77))


### Bug Fixes

* **integrations:** gate the ERPNext company query on an active binding ([#639](https://github.com/ariefsaid/PMO/issues/639)) ([#648](https://github.com/ariefsaid/PMO/issues/648)) ([ff2f41e](https://github.com/ariefsaid/PMO/commit/ff2f41e59236d1e6cb1ab56f2483273fdb25b8fc))

## [0.10.1](https://github.com/ariefsaid/PMO/compare/v0.10.0...v0.10.1) (2026-09-11)


### Bug Fixes

* **db:** 0215 — org checks fire after the org stamp; second-org e2e mode + post-deploy smoke ([#632](https://github.com/ariefsaid/PMO/issues/632) [#621](https://github.com/ariefsaid/PMO/issues/621) [#623](https://github.com/ariefsaid/PMO/issues/623)) ([#633](https://github.com/ariefsaid/PMO/issues/633)) ([624f7c3](https://github.com/ariefsaid/PMO/commit/624f7c3fa2dcfdfcba1e74537b8d1ad296f1a047))

## [0.10.0](https://github.com/ariefsaid/PMO/compare/v0.9.0...v0.10.0) (2026-09-07)


### Features

* **approvals:** bulk-approve returns to the desktop split inbox — one shared controller (OD-TS-6, [#592](https://github.com/ariefsaid/PMO/issues/592)) ([#606](https://github.com/ariefsaid/PMO/issues/606)) ([8316b94](https://github.com/ariefsaid/PMO/commit/8316b942a889d253fc0456f8840cd2ec4e547d9e))
* **approvals:** the awaiting-you queue lists only sheets the viewer can approve (OD-TS-5, [#591](https://github.com/ariefsaid/PMO/issues/591)) ([#605](https://github.com/ariefsaid/PMO/issues/605)) ([8d41b61](https://github.com/ariefsaid/PMO/commit/8d41b61c346db0fb907d950f6334c11655db4c43))
* **ci:** a hand-written row type may not silently shadow the schema ([#533](https://github.com/ariefsaid/PMO/issues/533)) ([#536](https://github.com/ariefsaid/PMO/issues/536)) ([e44a341](https://github.com/ariefsaid/PMO/commit/e44a3411ec1da97847e6f4f3ec455eefe296a6e7))
* **i18n:** the Bahasa pass ([#567](https://github.com/ariefsaid/PMO/issues/567)) — 1,055 keys, glossary-bound, and the id gate arrives green ([#570](https://github.com/ariefsaid/PMO/issues/570)) ([b06234b](https://github.com/ariefsaid/PMO/commit/b06234b4d1436605de584c7e80e27df65db564f8))
* **i18n:** the framework ([#547](https://github.com/ariefsaid/PMO/issues/547)) — 1,055 en keys, staged gate per DD-I18N-9 ([#569](https://github.com/ariefsaid/PMO/issues/569)) ([76a2cfe](https://github.com/ariefsaid/PMO/commit/76a2cfea12c3bdfb8eb97e375506ca7b8be8b77e))
* **m365:** three-step connection model — operator entitles, client admin approves, each user connects ([#428](https://github.com/ariefsaid/PMO/issues/428)) ([47bfab7](https://github.com/ariefsaid/PMO/commit/47bfab78b800d5f74b66c956884db78908e5bc46))
* **meetings:** the author may archive their own minute — FE gate widened to author-or-Admin (OD-MTG-3, [#589](https://github.com/ariefsaid/PMO/issues/589)) ([#604](https://github.com/ariefsaid/PMO/issues/604)) ([7e47926](https://github.com/ariefsaid/PMO/commit/7e479266c7dc4f05e5a463e4cd8db260ecc6be49))
* **meetings:** the meeting module ([#526](https://github.com/ariefsaid/PMO/issues/526)) — attendance-keyed reads, view-only shares, the /action seam ([#573](https://github.com/ariefsaid/PMO/issues/573)) ([effc82f](https://github.com/ariefsaid/PMO/commit/effc82fd3d315260ccc2ba963c16713f83a529aa))
* **money:** currency on every PMO-owned money table + sales-invoice tax treatment ([#478](https://github.com/ariefsaid/PMO/issues/478)) ([#506](https://github.com/ariefsaid/PMO/issues/506)) ([338c521](https://github.com/ariefsaid/PMO/commit/338c521ea156b726b7ab5ee88ecc6b5dd1e4b3e4))
* **skills:** port the Matt Pocock skill set with the MOS overlay convention ([#433](https://github.com/ariefsaid/PMO/issues/433)) ([df0bdb4](https://github.com/ariefsaid/PMO/commit/df0bdb40b978886152372614c97787f96cbd2984))
* **tax:** carry each deal's own tax basis through get_sales_pipeline() ([#578](https://github.com/ariefsaid/PMO/issues/578)) ([#580](https://github.com/ariefsaid/PMO/issues/580)) ([8c9200d](https://github.com/ariefsaid/PMO/commit/8c9200df83570fd30579b728b23478fdb0e4ff91))
* **tax:** the org-wide VAT default + a basis label on every money figure ([#548](https://github.com/ariefsaid/PMO/issues/548)) ([#579](https://github.com/ariefsaid/PMO/issues/579)) ([9fe5a42](https://github.com/ariefsaid/PMO/commit/9fe5a42f7082b8efdf74c0c4bd921776d604d6c7))
* **work-orders:** the drawdown surface the PM manages by ([#566](https://github.com/ariefsaid/PMO/issues/566)) ([#576](https://github.com/ariefsaid/PMO/issues/576)) ([bdc632d](https://github.com/ariefsaid/PMO/commit/bdc632d9d9baa7820fa3707259390562b6e9b85a))


### Bug Fixes

* **admin:** omit self-edit role/manager affordances on the caller's own row — the SSSF trial issue ([#436](https://github.com/ariefsaid/PMO/issues/436)) ([c7adfae](https://github.com/ariefsaid/PMO/commit/c7adfaee77679f8e08aebd245aca2c82c902dded))
* **currency:** a mixed-currency stage total breaks down, it does not convert ([#530](https://github.com/ariefsaid/PMO/issues/530) item 3, DD-CUR-6) ([#587](https://github.com/ariefsaid/PMO/issues/587)) ([0d46e8f](https://github.com/ariefsaid/PMO/commit/0d46e8fb2288568ec4b50aa8f8b98c955af47ef3))
* **dal:** a using-denied write is a silent no-op, not success ([#534](https://github.com/ariefsaid/PMO/issues/534)) ([#540](https://github.com/ariefsaid/PMO/issues/540)) ([6100805](https://github.com/ariefsaid/PMO/commit/610080561925d435cfffb353e9ed9e8b677d5e0c))
* **db:** a task's milestone must be a milestone of its own project ([#538](https://github.com/ariefsaid/PMO/issues/538)) ([#545](https://github.com/ariefsaid/PMO/issues/545)) ([0bc058b](https://github.com/ariefsaid/PMO/commit/0bc058b6bcd67499b0017cf9a7e1e7f6a158dc8c))
* **deps:** bump dompurify 3.4.12 → 3.4.13 (GHSA-55q2-fjhq-7xh7) ([#472](https://github.com/ariefsaid/PMO/issues/472)) ([c0458cb](https://github.com/ariefsaid/PMO/commit/c0458cbc93f0d13bc953447b5cc63d191b91c33b))
* **errors:** let a segregation-of-duties refusal say what the remedy is ([#577](https://github.com/ariefsaid/PMO/issues/577)) ([#583](https://github.com/ariefsaid/PMO/issues/583)) ([f7513d5](https://github.com/ariefsaid/PMO/commit/f7513d58e78afa74941a4c150d47d27487f761e3))
* **fe:** the pipeline lens crashed on every pre-win record; and the promote gate could certify an untested commit ([#554](https://github.com/ariefsaid/PMO/issues/554)) ([270813a](https://github.com/ariefsaid/PMO/commit/270813aefb02d77c8217d7a1994d35a2f76255d5))
* **format:** route all locale-sensitive display through format.ts + lint guard ([#477](https://github.com/ariefsaid/PMO/issues/477)) ([#483](https://github.com/ariefsaid/PMO/issues/483)) ([09ad04f](https://github.com/ariefsaid/PMO/commit/09ad04fe3fe80ebf486baf99647088e44f4ddeb3))
* **forms:** a rejected save leaves persistent evidence in the dialog ([#559](https://github.com/ariefsaid/PMO/issues/559)) ([#584](https://github.com/ariefsaid/PMO/issues/584)) ([d5f9390](https://github.com/ariefsaid/PMO/commit/d5f9390af6cb5ad4ec764fef5ff62041a93cdc39))
* **gate:** key the promote stamp on the TREE, which is what the gate actually tests ([#555](https://github.com/ariefsaid/PMO/issues/555)) ([#586](https://github.com/ariefsaid/PMO/issues/586)) ([45a7bad](https://github.com/ariefsaid/PMO/commit/45a7bad2b1d16e42ff20475f7f99e5cad45ce000))
* **i18n:** close the gate's project-detail scope hole, and stop it punishing plurals ([#575](https://github.com/ariefsaid/PMO/issues/575)) ([#581](https://github.com/ariefsaid/PMO/issues/581)) ([35f2ce0](https://github.com/ariefsaid/PMO/commit/35f2ce0a1a6e1f4d91789068514990da69a7e397))
* **m365:** restore opaque graph_proxy client envelope; keep structured upstream log ([#445](https://github.com/ariefsaid/PMO/issues/445)) ([#448](https://github.com/ariefsaid/PMO/issues/448)) ([eb4bdc6](https://github.com/ariefsaid/PMO/commit/eb4bdc68db6ac6387ef56169515d93ef13a003fc))
* **money:** a using-denied money write is a refusal, not a save ([#541](https://github.com/ariefsaid/PMO/issues/541)) ([#544](https://github.com/ariefsaid/PMO/issues/544)) ([f590909](https://github.com/ariefsaid/PMO/commit/f590909dac6189bc61b3456d1abb9acc42385367))
* **rls:** DD-TASK-8 rebuilt to the 3-lens review verdict — creator-scoped edit, pinned authorship, guarded external paths ([#568](https://github.com/ariefsaid/PMO/issues/568)) ([5f96dc8](https://github.com/ariefsaid/PMO/commit/5f96dc8f915a009004ae1090dbd5b6adb6cd215e)), closes [#551](https://github.com/ariefsaid/PMO/issues/551)
* **timesheets:** lock Save/Submit during a row delete, and never restore a row the user re-added ([#596](https://github.com/ariefsaid/PMO/issues/596)) ([#597](https://github.com/ariefsaid/PMO/issues/597)) ([f320044](https://github.com/ariefsaid/PMO/commit/f3200446e49b129ec247a598821e829370a388d9))
* **types:** resync database.types.ts, and fix the null-money bug it was hiding ([#508](https://github.com/ariefsaid/PMO/issues/508)) ([b1a9c8d](https://github.com/ariefsaid/PMO/commit/b1a9c8d6e952721a6ed3afc1c07cfee31dd1a93a))
* **ui:** ClickUp card — no integration errors on unconnected orgs, human-only error copy ([#458](https://github.com/ariefsaid/PMO/issues/458)) ([00bfc0c](https://github.com/ariefsaid/PMO/commit/00bfc0c27256d753e46885cd6dcf5475446b23b2))


### Refactors

* **i18n:** collapse the prefix/suffix fragment keys into whole sentences ([#571](https://github.com/ariefsaid/PMO/issues/571)) ([#574](https://github.com/ariefsaid/PMO/issues/574)) ([cdd85ae](https://github.com/ariefsaid/PMO/commit/cdd85ae26f12ef97001555b3df86616ca842ccde))

## [0.9.0](https://github.com/ariefsaid/PMO/compare/v0.8.0...v0.9.0) (2026-07-31)


### Features

* **analytics:** friction instrumentation, demo funnel, quota alarm, tile gate ([#399](https://github.com/ariefsaid/PMO/issues/399)) ([fee361a](https://github.com/ariefsaid/PMO/commit/fee361a6617bca8ee0b85be3007ce86a82e65a08))
* **analytics:** PostHog signal config + consent (opt-out, DNT, disclosure) ([#398](https://github.com/ariefsaid/PMO/issues/398)) ([b1c8f1a](https://github.com/ariefsaid/PMO/commit/b1c8f1a3d17654fd6cc2fd0afd80f8cae5f62547))
* **obs:** pipeline self-report + error_events retention ([#403](https://github.com/ariefsaid/PMO/issues/403)) ([a844d99](https://github.com/ariefsaid/PMO/commit/a844d9916fd5d4fc01c82d371a652ca7d3d11e48))


### Bug Fixes

* **agent:** stop the compaction re-query loop that hit the step limit with no answer ([#410](https://github.com/ariefsaid/PMO/issues/410)) ([5cb134c](https://github.com/ariefsaid/PMO/commit/5cb134cbb1a70bbc0767de3e6e0fbba7b7b02c99))
* **alerting:** write-ahead alert log — bound the re-alert loop without dropping alerts ([#400](https://github.com/ariefsaid/PMO/issues/400)) ([8c9f637](https://github.com/ariefsaid/PMO/commit/8c9f63702a683ec55ab3dcb961b81aa7d674ad21))
* **ci:** NUL bytes make three source files invisible to grep ([#394](https://github.com/ariefsaid/PMO/issues/394)) ([5f9fb7e](https://github.com/ariefsaid/PMO/commit/5f9fb7e8e03b15fda76b75dcc5c3f697f9db8a2a))
* **docs:** resolve ADR-0037 mis-cite — land monochrome-calm design ADR as 0068 ([#395](https://github.com/ariefsaid/PMO/issues/395)) ([782caa2](https://github.com/ariefsaid/PMO/commit/782caa20fe19b3825302431cbd7c7beab7f56489))
* **e2e:** un-quarantine AC-IXD-TS-W5-3 — drive the stacked fallback (small viewport) ([#405](https://github.com/ariefsaid/PMO/issues/405)) ([cb79f6e](https://github.com/ariefsaid/PMO/commit/cb79f6e04ee7679ae7644e2ea75a655dd5ab0141))
* **posthog:** quota alarm parsed a payload shape the API never returns ([#404](https://github.com/ariefsaid/PMO/issues/404)) ([d6c1164](https://github.com/ariefsaid/PMO/commit/d6c1164bfb4a29a90b1d1b36d9261305f1a5ba6f))
* **posthog:** quota alarm still reported all-clear having checked nothing ([#408](https://github.com/ariefsaid/PMO/issues/408)) ([9ed8411](https://github.com/ariefsaid/PMO/commit/9ed84118240cc8e331426760d1d7701e4fbe6cdd))
* **security:** close the create-path SoD class — INSERT and UPDATE, six tables ([#411](https://github.com/ariefsaid/PMO/issues/411)) ([eb39fc0](https://github.com/ariefsaid/PMO/commit/eb39fc0cb352d70ca76691b5758c85408e92289b))
* the ambiguous PostgREST embed that took 19 e2e specs down, + the ADR collision ([#413](https://github.com/ariefsaid/PMO/issues/413)) ([b978c04](https://github.com/ariefsaid/PMO/commit/b978c040d946c61e63666dac9faa4b8c6eb891c6))
* the workflow steps that were skipped, and the ten defects they found ([#409](https://github.com/ariefsaid/PMO/issues/409)) ([311caba](https://github.com/ariefsaid/PMO/commit/311caba50679ef4b684fb1d54407407ee3f4dd99))

## [0.8.0](https://github.com/ariefsaid/PMO/compare/v0.7.2...v0.8.0) (2026-07-25)


### ⚠ BREAKING CHANGES

* **deps:** react-router 7 → 8.3.0 + postcss — 0 advisories, waiver removed ([#384](https://github.com/ariefsaid/PMO/issues/384))

### Features

* **admin-connect:** external-system admin self-serve — P1 Vault credentials · P2 Connect/Disconnect · P3 project Link/Unlink · P4 health (flag-off) ([#332](https://github.com/ariefsaid/PMO/issues/332)) ([dea013c](https://github.com/ariefsaid/PMO/commit/dea013cdbb3667af6cfe34ca0bfccc14e6a537ec))
* **auth:** brand the Microsoft SSO button + restructure the login for a professional hierarchy ([#366](https://github.com/ariefsaid/PMO/issues/366)) ([fa8aa81](https://github.com/ariefsaid/PMO/commit/fa8aa810515128ff0558083ec0b8dc8ede748f76))
* **clickup:** parent ↔ parent_task_id bidirectional sync + OD-INT-14 single-org scoping ([#345](https://github.com/ariefsaid/PMO/issues/345)) ([7134577](https://github.com/ariefsaid/PMO/commit/7134577a90270fca93ddc3f5e66574023ab1b1f3))
* **erpnext:** P3 — Sales/AR money write-through (P3a, 9-round audited) + P3b/P3c slice-0 scaffolding ([c7b4ad1](https://github.com/ariefsaid/PMO/commit/c7b4ad16e72c60be33b53b72bbeb8b56251f4a1e))
* **integrations:** Admin ClickUp binding map — both directions ([#356](https://github.com/ariefsaid/PMO/issues/356)) ([c28d58b](https://github.com/ariefsaid/PMO/commit/c28d58b270e06524548f6c29d678c7f77b0d275e))
* **integrations:** atomic connect + operator-only trap-state recovery (final IEM slice) ([#357](https://github.com/ariefsaid/PMO/issues/357)) ([81a157f](https://github.com/ariefsaid/PMO/commit/81a157fad99b05f510979bb7c58f07646f6154b7))
* **lib:** withTimeout — generic mutation-hang safety net + adoption plan ([#383](https://github.com/ariefsaid/PMO/issues/383)) ([3860a34](https://github.com/ariefsaid/PMO/commit/3860a3490d62d493a2c433d1e8f35e54a6616ae7))
* **m365:** Microsoft 365 integration — Phase 0 (SSO + entitlement) + Phase 1 (Graph token custody, 4-round security-hardened) ([#333](https://github.com/ariefsaid/PMO/issues/333)) ([7261632](https://github.com/ariefsaid/PMO/commit/72616323fc15371e04f60e88e30d08d02beda8c2))
* **m365:** wire the Connect flow + add a read-only connection_status action ([#337](https://github.com/ariefsaid/PMO/issues/337)) ([e670fbf](https://github.com/ariefsaid/PMO/commit/e670fbf7992efd5ac7f9bdf584c6c42d804eab4e))
* **p3b/p3c:** timesheet + budget adapter cores, approved-only push gate, activated_at witness ([357f24f](https://github.com/ariefsaid/PMO/commit/357f24fef6a92060c7d2e400bce7257a57a82a53))
* **p3b:** timesheet sweep backstop (6.4) + AC-TSP-042 (6.5) + both audit-r4 escalations ([790065d](https://github.com/ariefsaid/PMO/commit/790065d993824bf8b4501bf09d8310a604c10b2c))
* **p3c:** budget sweep backstop + never-adopt, and close both audit HIGHs ([9c49a3e](https://github.com/ariefsaid/PMO/commit/9c49a3e17d1103bcaa2689f85280e599bc5ebaa5))
* **p3:** ERPNext width — Timesheets (P3b) + Budget (P3c), 11 audit rounds ([3ef8cbe](https://github.com/ariefsaid/PMO/commit/3ef8cbed1799dd9c9adb5626d57ed555a7a0ad2a))
* **tasks:** PMO archive affordance + exclude archived tasks from delivery rollups ([#352](https://github.com/ariefsaid/PMO/issues/352)) ([0f555e5](https://github.com/ariefsaid/PMO/commit/0f555e562bd4e24d0dfb22982bc66e1820d0cc93))
* **tasks:** subtask model — rollup exclusion + nested task register (OD-INT-9) ([#340](https://github.com/ariefsaid/PMO/issues/340)) ([05c242d](https://github.com/ariefsaid/PMO/commit/05c242d7ab49ed2727022eeb71ad95af77f80549))
* **tasks:** task model — description, priority, subtasks, archive (OD-INT-9) ([#339](https://github.com/ariefsaid/PMO/issues/339)) ([80f0ba2](https://github.com/ariefsaid/PMO/commit/80f0ba21dce9d2bfbf74cd53e11f09fa32403de9))
* **tasks:** wire description + priority end-to-end (they were dead columns) ([#350](https://github.com/ariefsaid/PMO/issues/350)) ([b0c38de](https://github.com/ariefsaid/PMO/commit/b0c38de535cb6e3ef8be5bb7f4fc0fe0f608a63a))


### Bug Fixes

* **ci,e2e:** unblock the promote — 2 self-inflicted regressions + 1 ambiguous locator ([#390](https://github.com/ariefsaid/PMO/issues/390)) ([d218f67](https://github.com/ariefsaid/PMO/commit/d218f670e5c9d11ae219ff35cb4814ba21e1a612))
* **ci:** deterministic PR→main integration gate + the local promotion-simulation convention ([#377](https://github.com/ariefsaid/PMO/issues/377)) ([c374432](https://github.com/ariefsaid/PMO/commit/c374432ebf9c9dfc88e557ea319469367f23c752))
* **clickup:** an unbound List never leaks tasks into PMO; sweep active bindings only ([#354](https://github.com/ariefsaid/PMO/issues/354)) ([c28e8ed](https://github.com/ariefsaid/PMO/commit/c28e8ed01d1e67116aa5086fb6f00f00dcd5d9b9))
* **clickup:** per-status resolution with pmo-only outcomes (OD-INT-13) ([#342](https://github.com/ariefsaid/PMO/issues/342)) ([83fed34](https://github.com/ariefsaid/PMO/commit/83fed34dced988ac44af14cb0fa73d1df7b10861))
* **clickup:** read filters, per-List watermarks, backoff clamp, atomic config merge ([#343](https://github.com/ariefsaid/PMO/issues/343)) ([237009b](https://github.com/ariefsaid/PMO/commit/237009bdc1d243e15a33640a4e3d59c5dfe6a1c7))
* **clickup:** webhook ingress rewrite — real envelope, per-org credentials, replay guard (OD-INT-11) ([#344](https://github.com/ariefsaid/PMO/issues/344)) ([c6d6196](https://github.com/ariefsaid/PMO/commit/c6d6196d218c289017d3250f4cde53419b923c5d))
* **docs,e2e:** resolve the ADR id collisions; correct a MISDIAGNOSED e2e quarantine ([#387](https://github.com/ariefsaid/PMO/issues/387)) ([eb9d006](https://github.com/ariefsaid/PMO/commit/eb9d0068f9e0df87f60f0b9303b964b15df02db5))
* **e2e:** 3 stale selectors/logins for intended merged UI changes ([#373](https://github.com/ariefsaid/PMO/issues/373)) ([47a4b4e](https://github.com/ariefsaid/PMO/commit/47a4b4ef7212f8ead7c7a9773d82c347086e6b15))
* **e2e:** AC-INV-001 guard polarity — gate on the served lane, not on CI ([#386](https://github.com/ariefsaid/PMO/issues/386)) ([5f58e76](https://github.com/ariefsaid/PMO/commit/5f58e76bd78a7d818f30a82951df64f1b19dd6f5))
* **e2e:** bench serial guards skip in CI, not throw — unblock dev→main promote ([#371](https://github.com/ariefsaid/PMO/issues/371)) ([b3527f4](https://github.com/ariefsaid/PMO/commit/b3527f469ceb0f06b73bbeb06e3b3b7fb06cb2e2))
* **e2e:** seed the ERPNext webhook secret into Vault — dev removed the env fallback ([e4eacbf](https://github.com/ariefsaid/PMO/commit/e4eacbf5a797b45fdc45bce0514e894112b884ad))
* **e2e:** the 2 root served-smoke specs also skip in CI (completes bench-guard fix) ([#372](https://github.com/ariefsaid/PMO/issues/372)) ([d9b9e7b](https://github.com/ariefsaid/PMO/commit/d9b9e7bc7e93e77aff1f337e371a0e0273e79256))
* **e2e:** widen the timesheet week allocator — an 8-minute wrap made the fix/verify loop self-poisoning ([2c7f586](https://github.com/ariefsaid/PMO/commit/2c7f5867cd080c5b1b89b4a7f8866210cb271e2f))
* **erpnext-p3a:** close round-4 audit — approver-side SoD, double-POST window, status/rollup integrity ([39a1c88](https://github.com/ariefsaid/PMO/commit/39a1c885e63d8afbd273d3bb6cf89e0cc65b7fd0))
* **erpnext-p3a:** close round-5/6 — retry duplication, SoD author set, amend convergence, usable UI ([2ee0acd](https://github.com/ariefsaid/PMO/commit/2ee0acd208207e58009d1b10f078b2778a437b05))
* **erpnext-p3a:** close round-7 cross-family audit — 10 blockers incl. our own fix regressions ([4a2b123](https://github.com/ariefsaid/PMO/commit/4a2b123e9a19f65d7dd2c97a0a2f2610b6616903))
* **erpnext-p3a:** close round-9 cross-family SHOULD-FIXes before the dev PR ([0a74cce](https://github.com/ariefsaid/PMO/commit/0a74cce9576543d1847f95dea41b8c2529ca5a2b))
* **erpnext-p3a:** close the re-audit hardening round — SoD, tenancy, and money-mirror integrity ([cd4f597](https://github.com/ariefsaid/PMO/commit/cd4f597222c9fb2e83674222450e49a65d2d504f))
* **erpnext-p3a:** close the round-3 audit — recovery, adoption, targeting, RLS ([a3b4db1](https://github.com/ariefsaid/PMO/commit/a3b4db14065f29c32e1535d431fd710e535d3f02))
* **integrations:** client write-routing must be project-aware — split-brain vs the DB gate ([#358](https://github.com/ariefsaid/PMO/issues/358)) ([7e135d4](https://github.com/ariefsaid/PMO/commit/7e135d47f0280be082d642dfed81a6fa2d1b0b04))
* **m365:** Operator-gate the connect surface + release the StrictMode status guard ([#365](https://github.com/ariefsaid/PMO/issues/365)) ([f69dc97](https://github.com/ariefsaid/PMO/commit/f69dc975bfb45376877a78403384fba5a5042ebf))
* **money:** Luna BLOCK 1 — anchor collision cross-domain guard ([9ebc071](https://github.com/ariefsaid/PMO/commit/9ebc071323a279744abfaddd9bb3a0cb64cd1578))
* **money:** Luna BLOCK 5 — map PE-receive camelCase repo input to the snake_case command + populate references ([a86417a](https://github.com/ariefsaid/PMO/commit/a86417abcf2d8c7e9a3f52bb3a6de1191b150bcd))
* **money:** revenue SI create leaves a DRAFT (submitOnCreate:false) — SoD is real (OD-SAR-DRAFT-SUBMIT) ([08cc3a3](https://github.com/ariefsaid/PMO/commit/08cc3a35e7b6642c1156c923d6e3a4b4fb19729f))
* **p3:** audit-r3 H-1/H-2 + the owner's graceful-escalation ruling for NaN and company ([305a6f7](https://github.com/ariefsaid/PMO/commit/305a6f72432f9fe86ff5da41346253a66032deb3))
* **p3b/p3c:** close all 7 round-2 audit findings + a HIGH the audit missed ([692a6e7](https://github.com/ariefsaid/PMO/commit/692a6e7c76e47d54e5c9d803b1991f831f7e322a))
* **p3b/p3c:** repair two cross-file breakages from the parallel lanes ([a1a486e](https://github.com/ariefsaid/PMO/commit/a1a486e1d09f1351ff406356ace79a620716238f))
* **p3c:** atomic snapshot-replace — the budget RPC was summing ACROSS generations ([2cd3639](https://github.com/ariefsaid/PMO/commit/2cd36398df9a31d8d63052e1b26e8179d3ac7722))
* **p3:** close all 5 e2e reds — budget UPSERT, retry storm, 422, backstop mint ([855e22d](https://github.com/ariefsaid/PMO/commit/855e22d87b6b7b47dbfc1196afcf8b252ebdf30b))
* **p3:** close all round-5 findings + HIGH-1b, a defect that defeated HIGH-1's own recovery ([18dd2ac](https://github.com/ariefsaid/PMO/commit/18dd2accfdbe6d6e1a70afff652479c7ad53c3bc))
* **p3:** close the last 5 round-3 findings + RUN the edge-fn tests in CI ([c3cd09d](https://github.com/ariefsaid/PMO/commit/c3cd09deccae6ef14be12b558998502e07927982))
* **p3:** close the max_rows class — the sweep round 8 asked for, in erpSnapshots ([444ed8b](https://github.com/ariefsaid/PMO/commit/444ed8be4a693e9c39b1685e024e3b6d696c6cc9))
* **p3c:** make the one-generation guarantee TRUE (advisory lock) + full-grain row key ([fabde7c](https://github.com/ariefsaid/PMO/commit/fabde7c5b2d8f34129114a10b57ea6432e7e0606))
* **p3c:** NEW-1 CRITICAL — "Actuals to date" was structurally 0.00 for every project ([f9b4850](https://github.com/ariefsaid/PMO/commit/f9b485003e905bac5cf65358e13b7ea39b1677c2))
* **p3c:** refuse overlapping fiscal years instead of silently picking one ([cefaaa3](https://github.com/ariefsaid/PMO/commit/cefaaa31f9a0e552bf9240f2fddcdca178003258))
* **p3c:** resolve the fiscal year from ERPNext's calendar + stop the seam dropping error codes ([9feb2ea](https://github.com/ariefsaid/PMO/commit/9feb2ea434893da29093d71fe58598902c90ca20))
* **p3:** delete the unreachable adoption branch + close round 7 ([431efe0](https://github.com/ariefsaid/PMO/commit/431efe05abe6f4e2b354a4ab487e1df3cae9ea09))
* **p3:** one money-honesty INVARIANT + round-6 HIGH + the 2 rework regressions ([d290837](https://github.com/ariefsaid/PMO/commit/d290837bf8caf99f596e16df1b76e1d6bf75a5b1))
* **p3:** page every unbounded PostgREST read — the invariant was certifying a truncated sum ([727bba2](https://github.com/ariefsaid/PMO/commit/727bba2f0e14df392a973540ea450d98f4235a6d))
* **p3:** round 9 — my own paging fix was the defect wearing the fix's clothes ([4606c27](https://github.com/ariefsaid/PMO/commit/4606c27304eb7b640360f10e09bebb9047e60ae2))
* **security:** brace-expansion bump — surgical, preserving the cross-platform tree ([91a7c9d](https://github.com/ariefsaid/PMO/commit/91a7c9d44ec84d50e2fe8bcd71f5c14c86f13023))
* **security:** bump brace-expansion 1.1.15→1.1.16 / 2.1.1→2.1.2 (GHSA-3jxr-9vmj-r5cp) ([37f75e9](https://github.com/ariefsaid/PMO/commit/37f75e95612733ed3e33351cc3a26aacefcb560f))
* **test:** de-flake the M365 ciphertext guard (asserted a random IV byte) ([#385](https://github.com/ariefsaid/PMO/issues/385)) ([06f740e](https://github.com/ariefsaid/PMO/commit/06f740eb0f2a5f6e7edc741375cb7be92741f060))
* **ui:** rework the P3b/P3c surfaces — the money-honesty class at category scope ([9382700](https://github.com/ariefsaid/PMO/commit/93827008e4ed50259fba302c40d57666f5e42f3d))


### Chores

* **deps:** react-router 7 → 8.3.0 + postcss — 0 advisories, waiver removed ([#384](https://github.com/ariefsaid/PMO/issues/384)) ([f8ecfd2](https://github.com/ariefsaid/PMO/commit/f8ecfd2e4c20549c4910bad7e88f0d79549d8047))

## [0.7.2](https://github.com/ariefsaid/PMO/compare/v0.7.1...v0.7.2) (2026-07-14)


### Bug Fixes

* **shell:** /views breadcrumb 'My Views' (+ prod hard-stop docs) — 0.7.2 ([#334](https://github.com/ariefsaid/PMO/issues/334)) ([b81c9de](https://github.com/ariefsaid/PMO/commit/b81c9de8f2a2819f0a073fe63b36d5b259045322))

## [0.7.1](https://github.com/ariefsaid/PMO/compare/v0.7.0...v0.7.1) (2026-07-14)


### Features

* **views:** enable My Views + AI composer by default; stop assistant claiming a false save ([#328](https://github.com/ariefsaid/PMO/issues/328)) ([49222a8](https://github.com/ariefsaid/PMO/commit/49222a801d24d4721697d85f159565e7a95b6e80))

## [0.7.0](https://github.com/ariefsaid/PMO/compare/v0.6.0...v0.7.0) (2026-07-13)


### Features

* **analytics:** wire 10 engagement/friction events + PostHog query helper + 3 hardening fixes ([#324](https://github.com/ariefsaid/PMO/issues/324)) ([3a22bcf](https://github.com/ariefsaid/PMO/commit/3a22bcf86927767b0ce7ec341d374c5fc4ca51ed))
* **auth:** local JWKS caller-JWT verification — pilot on compose-view (ADR-0057 Tasks 1–2) ([#314](https://github.com/ariefsaid/PMO/issues/314)) ([dd86076](https://github.com/ariefsaid/PMO/commit/dd860769bc7559832f53cff80d79d4f2566af31b))


### Bug Fixes

* **e2e:** AC-JWT-005 skips when compose-view isn't served (CI edge_runtime off) ([#316](https://github.com/ariefsaid/PMO/issues/316)) ([b1742ae](https://github.com/ariefsaid/PMO/commit/b1742ae0ad40b5822123a72721c4ad11ebfa25ca))
* **e2e:** green the 3 promote-integration failures (AC-CUA-090 hard + AC-AAN-036/AC-AW-012 flaky) ([#326](https://github.com/ariefsaid/PMO/issues/326)) ([2eecc37](https://github.com/ariefsaid/PMO/commit/2eecc37c638a1a734ff840d1c49268ec90e4adfe))
* **e2e:** make AC-DEL-022 retry-idempotent + AC-AUTHF-005 redirect timeout (promote-integration greens) ([#318](https://github.com/ariefsaid/PMO/issues/318)) ([d0fad99](https://github.com/ariefsaid/PMO/commit/d0fad99f08ea94cc89a8e6ba20661738683eeff9))


### Performance

* **e2e:** reuse captured session storageState + retire per-spec bcrypt ([#306](https://github.com/ariefsaid/PMO/issues/306)) ([082f8fa](https://github.com/ariefsaid/PMO/commit/082f8faf23b9e7b3c2c942e2de36c1e24a15207e))

## [0.6.0](https://github.com/ariefsaid/PMO/compare/v0.5.0...v0.6.0) (2026-07-11)


### Features

* **adapter-seam:** external-system adapter seam P0 (ADR-0055) ([#299](https://github.com/ariefsaid/PMO/issues/299)) ([2cbacd5](https://github.com/ariefsaid/PMO/commit/2cbacd51ab7ccbd0ac7c6ccc0100a43a30aa387d))
* **admin:** agent cost dashboard in the operator layer ([#297](https://github.com/ariefsaid/PMO/issues/297)) ([16d07cb](https://github.com/ariefsaid/PMO/commit/16d07cbc1cafabb22d88b3c4e65edb1bf4ad36bd))
* **agent:** no-train fallback tier with only-restricted routing ([#292](https://github.com/ariefsaid/PMO/issues/292)) ([4111fbd](https://github.com/ariefsaid/PMO/commit/4111fbdcc532e4d72efe20644c7831d8f7a19797))
* **agent:** parallel reads / serial writes in the tool loop ([#5](https://github.com/ariefsaid/PMO/issues/5)) ([#294](https://github.com/ariefsaid/PMO/issues/294)) ([311cc71](https://github.com/ariefsaid/PMO/commit/311cc71f9bc28b16efbb9af240a557a3f7eea7a5))
* **agent:** privacy-first provider pinning for prompt-cache locality ([#291](https://github.com/ariefsaid/PMO/issues/291)) ([98e2974](https://github.com/ariefsaid/PMO/commit/98e2974de1eccd28ddfd560f9e005c669155e6dc))
* **agent:** token-budget transcript compaction (shrink the replayed miss) ([#293](https://github.com/ariefsaid/PMO/issues/293)) ([d34fb7b](https://github.com/ariefsaid/PMO/commit/d34fb7bd8d5764a03eb9665b9a0f20f31a98e652))
* **clickup-adapter:** ClickUp adapter P1 — tasks domain flip + change-feed + onboarding (ADR-0055/0056) ([#307](https://github.com/ariefsaid/PMO/issues/307)) ([a109c21](https://github.com/ariefsaid/PMO/commit/a109c21d91a7272be35936eda33ea1c0da8bd79d))
* **edge:** forward edge-fn errors into PostHog Error Tracking (IG-audit P2) ([#305](https://github.com/ariefsaid/PMO/issues/305)) ([c36b72c](https://github.com/ariefsaid/PMO/commit/c36b72c3dd367089b71f66c3b47b0f8836d205bc))
* **edge:** request-rate throttle on agent-chat (IG-audit P1) ([#302](https://github.com/ariefsaid/PMO/issues/302)) ([348f955](https://github.com/ariefsaid/PMO/commit/348f955f91acc3a1e9196a1cf299411d8a441cbd))
* **telemetry:** capture cached_tokens + reasoning_tokens in agent_usage ([#290](https://github.com/ariefsaid/PMO/issues/290)) ([4f53ead](https://github.com/ariefsaid/PMO/commit/4f53eaddbb24b4f5314de37bc63945b319f4e5ad))
* **ts:** enable strict mode (fix 94 latent errors, incl. 2 real null bugs) ([#300](https://github.com/ariefsaid/PMO/issues/300)) ([dbf902d](https://github.com/ariefsaid/PMO/commit/dbf902df713d9ffca05fc39bdf7f14ebee10356d))


### Bug Fixes

* **e2e:** AC-ACD-010 locator — scope to stat-tiles + exact match ([a43dcc7](https://github.com/ariefsaid/PMO/commit/a43dcc77c0b9001b136bd299ac060e8d4ed647ef))


### Performance

* **test:** split Vitest into node + jsdom projects ([#309](https://github.com/ariefsaid/PMO/issues/309)) ([2708b66](https://github.com/ariefsaid/PMO/commit/2708b66ba81d4845247776e8ec6fef83bb138e86))

## [0.5.0](https://github.com/ariefsaid/PMO/compare/v0.4.0...v0.5.0) (2026-07-09)


### Features

* **agent:** enable automations — fix owner-JWT mint + Vault/dispatch-secret + daily/weekly/dom schedules ([#285](https://github.com/ariefsaid/PMO/issues/285)) ([7bde543](https://github.com/ariefsaid/PMO/commit/7bde543641e934e1b14f8f26d4adb875630bec4c))


### Bug Fixes

* **ui:** remove client-facing repo links + edge-version label ([#282](https://github.com/ariefsaid/PMO/issues/282)) ([0dbf2f5](https://github.com/ariefsaid/PMO/commit/0dbf2f576fcd68278320653117c82209bc745089))

## [0.4.0](https://github.com/ariefsaid/PMO/compare/v0.3.0...v0.4.0) (2026-07-08)


### Features

* **agent:** follow-up multi-turn fix + live interactivity + latency + edge versioning ([#277](https://github.com/ariefsaid/PMO/issues/277)) ([d2148bf](https://github.com/ariefsaid/PMO/commit/d2148bfdfb743ecb4c903e2d8589ef1a57ddb8b3))


### Bug Fixes

* **agent:** follow-up on a History-loaded conversation (adoptRun) ([d73bfde](https://github.com/ariefsaid/PMO/commit/d73bfdee99607ca3a7a30100e7a5b654c61960df))

## [0.3.0](https://github.com/ariefsaid/PMO/compare/v0.2.0...v0.3.0) (2026-07-08)


### Features

* **agent:** persistent activity trail + reassuring long-run copy ([f0f3766](https://github.com/ariefsaid/PMO/commit/f0f3766ccd1197cf4b9b78b32be929301b31ddc5))
* **agent:** persistent activity trail + reassuring long-run copy ([c31b40e](https://github.com/ariefsaid/PMO/commit/c31b40e880e138f84c76a33eae6f158e230567c6))
* automatic versioning — release-please on main + in-app version/sha (ADR-0042 adoption) ([6896e9a](https://github.com/ariefsaid/PMO/commit/6896e9a405b083c5450c7d7d8d1fa0d22ae5fdfc))
* **version:** show app version + sha in-app (ADR-0042 §2) ([60985fd](https://github.com/ariefsaid/PMO/commit/60985fd2253fe83f4ad824e9b05212b8f1393e4a))


### Bug Fixes

* **agent:** align stuck-banner fallback copy with the Stop/Retry buttons ([8a869f1](https://github.com/ariefsaid/PMO/commit/8a869f19c4068000e64372502f2576111218287c))
* **agent:** create the run when it doesn't exist, not when runId is absent — fixes browser-run 42501/errors ([fd62df5](https://github.com/ariefsaid/PMO/commit/fd62df5798ddc65abd9154e7e94d1145bceb2c7a))
* **agent:** persist the run when it doesn't exist (not when runId absent) — fixes multi-round errors + empty usage ([f730b72](https://github.com/ariefsaid/PMO/commit/f730b728b729e53c0333f0774f7e82942161590e))
* **release:** co-locate CHANGELOG under pmo-portal (release-please rejected ../ path) ([a2f94c3](https://github.com/ariefsaid/PMO/commit/a2f94c31c6f811525f270659cfef9ac06cb15572))
* **release:** move CHANGELOG under pmo-portal + drop illegal ../ changelog-path ([b911c34](https://github.com/ariefsaid/PMO/commit/b911c3447932dad4798fd16f372381a6157f4d1f))

## [Unreleased]

_release-please accrues entries here from Conventional Commits landing on `main`._

## [0.2.0] — 2026-07-08 (current production baseline)

The first **three-tier** release: adds the app's first server-side tier (Deno edge functions) on
top of the SPA→Supabase base. **MINOR** per ADR-0042 (new user-facing modules **and** a new
architectural tier).

> Deploy manifest: app `1f68058` · DB migrations `→0081` · edge functions `agent-chat`,
> `compose-view`, `agent-dispatch`, `admin-invite-user`, `health`, `telegram-notify` deployed to
> the prod Cloud project (`prwccpsiumjzvnwjlkwq`).
> **Known gap (the ADR-0042 blocker, now realised):** the promote deployed DB + frontend but a
> stale `agent-chat` (the 2026-07-08 promote did not actually redeploy it — caught 2026-07-08 via
> `supabase functions list`). An edge-function deploy + a post-deploy version check are being added
> so this cannot recur silently.

### Added
- **Agent-native in-app assistant (ADR-0040/0041)** — the ⌘J `AssistantPanel`; a streaming
  `agent-chat` **edge-function deputy** (read-only `query_entity`; write actions `create_activity`
  /`update_task_status` with approve-deny SoD; compose-a-view); the `AgentRuntime` port +
  `PmoNativeRuntime` client adapter. Feature-flagged (`VITE_FEATURES_AGENT_ASSISTANT`).
- **Broadened agent read scope** — the deputy now reads the full business surface (procure-to-pay
  lifecycle, CRM activities, budget line items, docs, team, notifications), each RLS-scoped with a
  curated column allowlist (the `org_id` seam is never surfaced).
- **Live step trail** — the assistant panel shows the current action present-tense while the agent works.
- **User-composed views (ADR-0036 I3–I5)** — `/views` renderer, "Compose with AI" via the
  `compose-view` edge function, Save-to-My-Views (`user_views`, migration 0045).
- **DB hardening** — FK hot-path indexes (0042), incident→project FK (0043), dashboard status
  helpers (0044), auth-floor + org-seam + feature-flag server-enforcement (migs through 0081).

### Notes
- The agent tier adds **no new business tables** — the deputy acts over existing RLS-protected tables
  under the caller's JWT (RLS is the enforcement ceiling).
- The CRUD/RBAC foundation (ADR-0016–0019) and the procurement case-folder records (migs 0035–0041)
  are **already in 0.1.0** (shipped to prod 2026-06-21) — they are not part of this release.

## [0.1.0] — 2026-06-21 (production baseline)

The versioning baseline: the two-tier SPA→Supabase app as it stood live in production when this
convention was adopted (ADR-0042). Not retroactively decomposed into earlier tags. Encompasses the
full pre-agent product — backend foundation, write MVP, CRUD/RBAC foundation, UI/UX programs,
deployment, analytics, and the procurement case-folder record model.

> Deploy manifest: app `fc312eb` · DB migrations `→0041` · no edge functions.

[Unreleased]: https://github.com/ariefsaid/PMO/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ariefsaid/PMO/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ariefsaid/PMO/releases/tag/v0.1.0
