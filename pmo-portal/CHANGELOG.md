# Changelog

All notable changes to PMO Portal are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
**ADR-0042** (SemVer, pre-1.0 while single-tenant MVP). A version is minted on **`main`** (the
release-please flow — amended 2026-07-08, was `main → production`) and git-tagged `vX.Y.Z` on the
`main` commit; `main → production` then deploys an already-tagged commit.

Each released section pins the full deploy manifest (app sha · DB migration high-water ·
edge-function state) so "what's in production" is unambiguous. The DB schema version (migration
high-water mark) moves independently of the product tag.

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
