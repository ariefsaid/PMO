/**
 * S4 — the missing-tool detector and route templating (FR-PLN-009 / AC-PLN-007), pure functions.
 *
 * The handler-level proof (one event, no text, consent) lives in plansFeatureSwitches.test.ts; this
 * suite pins the DETECTOR itself in both directions, because a false positive inflates a demand signal
 * the owner acts on, and a false negative hides a module that users keep asking for.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectMissingTool, guessModule, routeTemplate, UNKNOWN_MODULE } from './missingTool.ts';

Deno.test('detectMissingTool — recognises "no tool" answers', () => {
  const cases = [
    "I don't have a tool for stock.",
    'I do not have any tool to read warehouse movements.',
    'There is no tool that can list bills for me.',
    "The tool for stock isn't available to me.",
    "Stock isn't on your organisation's plan.",
    'Stock is not part of your plan.',
    'That is not included in the plan.',
    'Stock is not available on your plan.',
    'The stock feature is not available for your organisation.',
  ];
  for (const answer of cases) {
    assertEquals(
      detectMissingTool({ question: 'How much cement is on hand?', answer }) !== null,
      true,
      `should match: ${answer}`,
    );
  }
});

Deno.test('detectMissingTool — ordinary answers never match', () => {
  const cases = [
    'There are 4 active projects.',
    "I couldn't find any blocking tasks in your projects.",
    "I don't have access to that project.",
    'The invoice is not available yet — it is still a draft.',
    '',
  ];
  for (const answer of cases) {
    assertEquals(detectMissingTool({ question: 'Show me my projects', answer }), null, `must not match: ${answer}`);
  }
});

Deno.test('detectMissingTool — the module guess comes from a fixed vocabulary, never from the text', () => {
  const q = 'How much cement is on hand in gudang A?';
  assertEquals(detectMissingTool({ question: q, answer: "Stock isn't on your organisation's plan." })?.module, 'stock');
  assertEquals(guessModule('Any incidents this month?', "That isn't on your plan."), 'incidents');
  assertEquals(guessModule('What invoices are unpaid?', "I don't have a tool for invoices."), 'sales_invoices');
  assertEquals(guessModule('Where is my purchase order?', "I don't have a tool for that."), 'procurement');
  // Nothing recognisable → the constant, never a slice of the question.
  assertEquals(guessModule('Tell me about zorblax', "I don't have a tool for that."), UNKNOWN_MODULE);
});

Deno.test('detectMissingTool — the guess ignores ids and free text (only vocabulary words map)', () => {
  const result = detectMissingTool({
    question: 'Why is 0b9a1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d blocked?',
    answer: 'There is no tool for that.',
  });
  assertEquals(result?.module, UNKNOWN_MODULE);
});

Deno.test('detectMissingTool — the source separates "not built" from "not on your plan"', () => {
  assertEquals(
    detectMissingTool({ question: 'How much cement is on hand?', answer: "Stock isn't on your organisation's plan." })?.source,
    'plan',
  );
  assertEquals(
    detectMissingTool({ question: 'How much cement is on hand?', answer: 'Stock is not available on your plan.' })?.source,
    'plan',
  );
  assertEquals(
    detectMissingTool({ question: 'How much cement is on hand?', answer: "I don't have a tool for stock." })?.source,
    'missing',
  );
  assertEquals(
    detectMissingTool({ question: 'Any incidents?', answer: 'There is no tool that can list incidents.' })?.source,
    'missing',
  );
});

Deno.test('routeTemplate — ids and query strings never leave the app', () => {
  assertEquals(routeTemplate('/projects/0b9a1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d/stock?tab=levels'), '/projects/:id/stock');
  assertEquals(routeTemplate('/procurement/42'), '/procurement/:id');
  assertEquals(routeTemplate('/stock#top'), '/stock');
  assertEquals(routeTemplate(undefined), undefined);
  assertEquals(routeTemplate(''), undefined);
  // A long static path is clamped to the 64-char server-property ceiling.
  const long = `/${'a'.repeat(120)}`;
  assertEquals(routeTemplate(long)?.length, 64);
});
