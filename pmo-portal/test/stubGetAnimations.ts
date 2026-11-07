// jsdom has no Element.getAnimations; Base UI's scroll area (used by the ReUI Gantt) calls it on a timer.
// Imported only by suites that render Base UI scroll areas (Gantt, timeline, filter builder): a global stub kept closed Base UI dialogs mounted elsewhere (#1980).
if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
export {};
