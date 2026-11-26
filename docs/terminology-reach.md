# Organisation terminology reach inventory

Organisation wording belongs wherever a product term or built-in role is shown: navigation, page and section headings, lists and counts, filters, forms and placeholders, actions and confirmation dialogs, validation and refusal messages, empty and error states, dashboards and reports, approval steps and their owners, recipient selectors, in-app notification titles and bodies, email subjects and bodies, exports, and printouts including their headings and signature roles. Organisation-entered names and other record values remain their entered values.

The table lists the locale namespaces containing registered default forms, in each language. Namespace files are under `pmo-portal/public/locales/<language>/<namespace>.json`; matching includes singular and plural forms and does not imply that every match has the same meaning. Runtime fallback strings, stored notification text, role labels, and document generators also need review when they use a term. The registry and the locale-terms guard are the maintained references for forms and scopes.

| Term key | English namespaces | Indonesian namespaces |
| --- | --- | --- |
| `workOrder` | administration, billingSteps, closeout, common, crews, dashboard, equipment, equipmentPlans, finance, financeHub, import, imprest, incidents, materialRequests, myHome, procurement, procurementRecord, project, projectTabs, quantityChanges, refusals, safety, siteReport, stock, supplyRisk, survey, tasks, usageStandards, waitingList, workInHand, workOrderCost, workOrderPva, workOrderRevenuePlan, workOrderSections, workOrders | administration, billingSteps, common, crews, dashboard, equipment, financeHub, import, imprest, incidents, materialRequests, procurement, project, refusals, siteReport, stock, survey, waitingList, workOrderPva, workOrderSections, workOrders |
| `project` | administration, assistantPanel, auth, boardDrag, calendar, closeout, common, costAttribution, crewTools, crews, dashboard, emailNotifications, equipment, equipmentPlans, expenseClaims, finance, financeHub, home, import, imprest, incidents, journals, legal, materialRequests, notifications, plans, procurement, procurementCreate, procurementList, procurementRecord, project, projectTabs, projects, quantityChanges, recordFolders, refusals, safety, sales, siteReport, stock, supplyRisk, survey, timeAndMaterials, timesheets, usageStandards, viewBuilder, waitingList, workInHand, workOrderCost, workOrderPva, workOrders | administration, assistantPanel, auth, boardDrag, calendar, closeout, common, costAttribution, crews, dashboard, equipment, equipmentPlans, expenseClaims, finance, financeHub, home, import, imprest, incidents, journals, materialRequests, notifications, plans, procurement, procurementCreate, procurementList, procurementRecord, project, projectTabs, projects, quantityChanges, recordFolders, refusals, safety, sales, siteReport, stock, supplyRisk, survey, timeAndMaterials, timesheets, usageStandards, viewBuilder, waitingList, workInHand, workOrderCost, workOrderPva, workOrders |
| `clientSuppliedStock` | import | import, refusals |
| `purchaseRequest` | common, finance, imprest, procurement, procurementCreate, procurementList, procurementRecord, workOrderPva, workOrders | common, dashboard, finance, imprest, procurement, procurementCreate, procurementList, procurementRecord, workOrderPva, workOrders |
| `discipline` | administration, common, crews, equipment, finance, import, procurement, refusals, workOrderCost, workOrderPva, workOrders | administration, common, crews, equipment, finance, import, procurement, refusals, workOrderCost, workOrderPva, workOrders |
| `materialRequest` | administration, common, dashboard, materialRequests, notifications, refusals, stock, tasks, usageStandards | administration, common, dashboard, materialRequests, notifications, refusals, stock, tasks, usageStandards, workOrders |
| `billOfQuantities` | common, project, projectTabs | common, project, projectTabs |
| `contractItem` | project, siteReport, subcontractCertificates | project, siteReport, subcontractCertificates |
| `dailyRevenue` | siteReport, workOrderRevenuePlan | siteReport, workOrderRevenuePlan |
| `acceptedQuantity` | common, project, projectTabs, workOrders | administration, common, notifications, procurement, project, projectTabs, workOrders |
| `costVariation` | procurement | procurement |
| `deliveryNote` | administration, common, import, materialRequests, procurement, refusals, stock | administration, common, import, materialRequests, procurement, refusals, stock, workOrders |
| `stockCount` | stock | stock |
| `imprest` | dashboard, financeHub, imprest, notifications, plans, procurement, waitingList | dashboard, financeHub, imprest, notifications, plans, procurement, waitingList |
| `standIn` | common, materialRequests, refusals | common, incidents, materialRequests, notifications, project |
| `progressClaim` | common, project, projectTabs | common, project |
| `serviceRequest` | — | — |
| `purchaseOrder` | administration, assistantPanel, common, finance, procurement, procurementList, procurementRecord, project, refusals, status, stock, subcontractCertificates, workOrderPva, workOrders | administration, assistantPanel, common, finance, procurement, procurementList, procurementRecord, project, refusals, status, stock, subcontractCertificates, workOrderPva, workOrders |
| `dailySiteReport` | administration, common, import, incidents, materialRequests, notifications, project, quantityChanges, refusals, siteReport, stock, subcontractCertificates, waitingList, workOrderRevenuePlan, workOrders | administration, import, incidents, materialRequests, notifications, project, quantityChanges, refusals, siteReport, stock, subcontractCertificates, waitingList, workOrderPva, workOrderRevenuePlan, workOrders |
| `surveyQuantity` | administration, projectTabs, refusals, survey | survey |
| `quantityChangeRequest` | notifications, quantityChanges, refusals | notifications, quantityChanges, refusals |
| `workOrderTransfer` | administration, common, refusals, stock | administration, common |
| `billingPlan` | common, finance | common, finance |
| `billingStep` | billingSteps, common, dashboard, emailNotifications, finance, notifications, project, refusals | billingSteps, common, dashboard, emailNotifications, finance, notifications, project, refusals |
| `handoverCertificate` | refusals, stock | refusals, stock |
| `stockTransfer` | common, stock | common, stock |
| `stockReceipt` | administration, common, finance, procurement, status, workOrderPva, workOrders | administration, common, finance, financeHub, procurement, status, workOrderPva, workOrders |
| `stockReturn` | stock | stock |
| `reservation` | administration, common, refusals, stock, workOrders | administration, common, refusals, workOrders |
| `crew` | administration, common, crewTools, crews, equipment, import, myHome, notifications, refusals, safety, siteReport, subcontractCertificates, workOrderPva, workOrderSections, workOrders | administration, common, crewTools, crews, equipment, import, myHome, notifications, refusals, safety, siteReport, subcontractCertificates, workOrderPva, workOrderSections, workOrders |
| `roster` | administration, crews, myHome, refusals, safety, siteReport, workOrders | refusals |
| `issue` | administration, common, emailNotifications, equipment, finance, import, incidents, materialRequests, myHome, notifications, procurement, project, projectTabs, refusals, siteReport, stock, survey, tasks, waitingList, workOrders | administration, common, crewTools, emailNotifications, finance, incidents, myHome, notifications, refusals, tasks, workOrders |
| `checkpoint` | administration, notifications, siteReport | administration, notifications, siteReport |
| `milestone` | assistantPanel, calendar, dashboard, project | assistantPanel, calendar, dashboard, project |
| `dailyTarget` | common, workOrderRevenuePlan | common, workOrderRevenuePlan |
| `rootCause` | incidents | incidents |
| `safetyRecordType` | administration, common, safety | administration, common, safety |
| `candidateWorkOrder` | finance, refusals, workOrders | finance, refusals, workOrders |
| `closeOut` | closeout, dashboard, notifications, status, workOrders | closeout, common, dashboard, incidents, journals, notifications, project, projectTabs, status, workInHand, workOrders |
| `workOrderPlan` | refusals, workOrderSections | workOrderSections |
| `foreman` | administration, crews, myHome, refusals, workOrderSections | administration, crews, myHome, refusals, workOrderSections |
