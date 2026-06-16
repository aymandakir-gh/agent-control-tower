/**
 * Both shipped adapters must satisfy the same conformance contract (PRD §12).
 * Each scenario is authored once per dialect (Claude Code via TranscriptBuilder,
 * generic via GenericTranscriptBuilder) and asserted against the SAME expected
 * semantics in conformance.ts — proving the adapters are interchangeable.
 */

import { claudeCodeAdapter, genericJsonlAdapter } from '../../src/sources/index.js';
import { TranscriptBuilder } from '../fixtures/builder.js';
import { GenericTranscriptBuilder } from '../fixtures/generic-builder.js';
import { runAdapterConformance, type ScenarioCase } from './conformance.js';

const IDLE_MS = 120_000;
const OPUS = 'claude-opus-4-8';

// ── Claude Code dialect ──────────────────────────────────────────────────────
function claudeCases(): Record<string, ScenarioCase> {
  const cases: Record<string, ScenarioCase> = {};

  {
    const b = new TranscriptBuilder();
    b.prompt('run tests').assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] });
    cases['working: unresolved non-interactive tool'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new TranscriptBuilder();
    b.prompt('run tests')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1' });
    cases['working: assistant awaiting tool results'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new TranscriptBuilder();
    b.prompt('which?').assistant({ tools: [{ name: 'AskUserQuestion', id: 'toolu_1' }] });
    cases['waiting: interactive tool pending'] = { text: b.build(), now: b.clock + 5_000 };
  }
  {
    const b = new TranscriptBuilder();
    b.prompt('build it')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true })
      .assistant({ text: 'that failed', stopReason: 'end_turn' });
    cases['error: tool failed then turn ended'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn' });
    cases['idle: completed turn long ago'] = { text: b.build(), now: b.clock + 5 * IDLE_MS };
  }
  {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn' });
    cases['waiting: completed turn recently'] = { text: b.build(), now: b.clock + 5_000 };
  }
  {
    const b = new TranscriptBuilder({ model: OPUS });
    b.prompt('spend').assistant({
      text: 'ok',
      stopReason: 'end_turn',
      model: OPUS,
      usage: { input: 1_000, output: 500 }, // opus: (1000*15 + 500*75)/1e6 = 0.0525
    });
    cases['cost: opus usage is priced exactly'] = { text: b.build(), now: b.clock + 5_000 };
  }

  return cases;
}

// ── Generic JSONL dialect ────────────────────────────────────────────────────
function genericCases(): Record<string, ScenarioCase> {
  const cases: Record<string, ScenarioCase> = {};

  {
    const b = new GenericTranscriptBuilder();
    b.prompt('run tests').assistant({ tools: [{ name: 'Bash', id: 't1' }] });
    cases['working: unresolved non-interactive tool'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new GenericTranscriptBuilder();
    b.prompt('run tests')
      .assistant({ tools: [{ name: 'Bash', id: 't1' }] })
      .toolResult({ toolUseId: 't1' });
    cases['working: assistant awaiting tool results'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new GenericTranscriptBuilder();
    b.prompt('which?').assistant({ tools: [{ name: 'AskUserQuestion', id: 't1' }] });
    cases['waiting: interactive tool pending'] = { text: b.build(), now: b.clock + 5_000 };
  }
  {
    const b = new GenericTranscriptBuilder();
    b.prompt('build it')
      .assistant({ tools: [{ name: 'Bash', id: 't1' }] })
      .toolResult({ toolUseId: 't1', error: true })
      .assistant({ text: 'that failed', stop: 'end_turn' });
    cases['error: tool failed then turn ended'] = { text: b.build(), now: b.clock + 2_000 };
  }
  {
    const b = new GenericTranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stop: 'end_turn' });
    cases['idle: completed turn long ago'] = { text: b.build(), now: b.clock + 5 * IDLE_MS };
  }
  {
    const b = new GenericTranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stop: 'end_turn' });
    cases['waiting: completed turn recently'] = { text: b.build(), now: b.clock + 5_000 };
  }
  {
    const b = new GenericTranscriptBuilder({ model: OPUS });
    b.prompt('spend').assistant({
      text: 'ok',
      stop: 'end_turn',
      model: OPUS,
      usage: { input: 1_000, output: 500 },
    });
    cases['cost: opus usage is priced exactly'] = { text: b.build(), now: b.clock + 5_000 };
  }

  return cases;
}

runAdapterConformance(claudeCodeAdapter, claudeCases());
runAdapterConformance(genericJsonlAdapter, genericCases());
