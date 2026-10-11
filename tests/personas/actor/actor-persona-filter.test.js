import { expect, test } from 'vitest';
import { createActorPersona } from '../../../packages/runtime/src/personas/actor/persona.js';
import { TickPhases } from '../../../packages/runtime/src/personas/_shared/tick-state-machine.mts';

test.each(['delver', 'warden', 'hazard', 'resource', 'barrier'])('living %s proposals use the common eligibility path', category => {
  for (const lifecycle of ['alive', 'defeated', 'exited', 'absent']) {
    const persona = createActorPersona({ clock: () => 'fixed' });
    const self = { id: 'self', category, lifecycle, position: { x: 1, y: 1 }, motivations: [] };
    const payload = {
      actorId: 'self', observation: { actors: lifecycle === 'absent' ? [] : [self] },
      proposals: [{ kind: 'wait', params: {} }],
    };
    persona.advance({ phase: TickPhases.OBSERVE, event: 'observe', payload, tick: 0 });
    persona.advance({ phase: TickPhases.DECIDE, event: 'decide', payload, tick: 0 });
    const result = persona.advance({ phase: TickPhases.DECIDE, event: 'propose', payload, tick: 1 });
    expect(result.actions.map(action => action.kind)).toEqual(lifecycle === 'alive' ? ['wait'] : []);
  }
});

// ## TODO: Test Permutations
// - Solver-enabled defeated actors also emit no decision request.
