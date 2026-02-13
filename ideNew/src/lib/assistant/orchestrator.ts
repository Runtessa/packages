import type { Agent } from '@mastra/core/agent';

type ChatMessage = { role: string; content: string };

export type AssistantRunPhase =
  | 'S0_INIT'
  | 'S1_ANALYSIS'
  | 'S2_EXTRACTION'
  | 'S3_SYNTHESIS'
  | 'S4_PRODUCTION';

export type AssistantRunEventType =
  | 'RUN_REQUESTED'
  | 'CONTEXT_CAPTURED'
  | 'PLAN_READY'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_COMPLETED'
  | 'CONFLICT_FOUND'
  | 'RETRY_REQUESTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED';

export type AssistantRunEvent = {
  id: string;
  runId: string;
  type: AssistantRunEventType;
  phase: AssistantRunPhase;
  timestamp: string;
  artifactRef?: string;
  payload?: Record<string, unknown>;
};

export type AssistantRunNode = {
  id: string;
  label: string;
  phase: AssistantRunPhase;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempt: number;
};

export type AssistantRunEdge = {
  fromNodeId: string;
  toNodeId: string;
  eventType: AssistantRunEventType;
};

export type AssistantRunConflict = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  relatedNodeIds: string[];
};

type AssistantRunArtifact = {
  id: string;
  kind:
    | 'request_messages'
    | 'workspace_context'
    | 'execution_plan'
    | 'execution_output'
    | 'validation_report';
  payload: unknown;
};

type AssistantRunState = {
  runId: string;
  events: AssistantRunEvent[];
  artifacts: Map<string, AssistantRunArtifact>;
  nodes: AssistantRunNode[];
  edges: AssistantRunEdge[];
  conflicts: AssistantRunConflict[];
};

type ExecuteAssistantRunInput = {
  runId?: string;
  agent: Agent;
  messages: ChatMessage[];
  systemPrompt: string;
  contextText: string;
  maxSteps: number;
  maxRetries: number;
  onDelta?: (delta: string) => void;
  onEvent?: (event: AssistantRunEvent) => void;
  collectChanges: () => unknown[];
};

export type ExecuteAssistantRunResult = {
  runId: string;
  message: string;
  finishReason?: string;
  usage?: unknown;
  events: AssistantRunEvent[];
  artifacts: Array<{
    id: string;
    kind:
      | 'request_messages'
      | 'workspace_context'
      | 'execution_plan'
      | 'execution_output'
      | 'validation_report';
    payload: unknown;
  }>;
  dag: {
    nodes: AssistantRunNode[];
    edges: AssistantRunEdge[];
  };
  conflicts: AssistantRunConflict[];
};

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 12)}`;
};

const lastUserPrompt = (messages: ChatMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'user' && msg.content.trim()) return msg.content.trim();
  }
  return '';
};

const buildExecutionPlan = (prompt: string) => {
  const parts = prompt
    .split(/[\n.!?]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = parts.slice(0, 8).map((step, index) => ({
    id: `step_${index + 1}`,
    action: step,
  }));
  return {
    summary: prompt || 'Apply requested changes in workspace',
    steps,
  };
};

const validateExecution = (
  prompt: string,
  outputText: string,
  changeCount: number,
  executionNodeId: string
) => {
  const conflicts: AssistantRunConflict[] = [];
  const wantsMutation = /\b(create|edit|update|delete|remove|add|implement|fix|refactor)\b/i.test(
    prompt
  );
  const mentionsAcl = /\bacl|permission|permissions|roles|endpoints\b/i.test(prompt);
  const noChangeText = /no changes were applied/i.test(outputText);

  if (wantsMutation && changeCount === 0) {
    conflicts.push({
      id: createId(),
      severity: 'high',
      message: 'Request implies changes but no file/tool mutations were applied.',
      relatedNodeIds: [executionNodeId],
    });
  }
  if (mentionsAcl && changeCount === 0) {
    conflicts.push({
      id: createId(),
      severity: 'medium',
      message: 'ACL-related request returned no updates. ACL JSON likely unchanged.',
      relatedNodeIds: [executionNodeId],
    });
  }
  if (wantsMutation && noChangeText) {
    conflicts.push({
      id: createId(),
      severity: 'high',
      message: 'Assistant explicitly reported no changes for a mutation request.',
      relatedNodeIds: [executionNodeId],
    });
  }
  return conflicts;
};

const runAgentExecution = async (
  input: Pick<ExecuteAssistantRunInput, 'agent' | 'messages' | 'maxSteps' | 'onDelta'>,
  system: string
) => {
  const streamed = await input.agent.stream(input.messages as any, {
    system,
    maxSteps: input.maxSteps,
  });
  const reader = streamed.textStream.getReader();
  let fullText = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    fullText += value;
    input.onDelta?.(value);
  }
  const output = await streamed.getFullOutput();
  const usage = await streamed.totalUsage;
  return {
    text: output.text?.trim() || fullText.trim(),
    finishReason: output.finishReason,
    usage,
  };
};

class AssistantRunStore {
  state: AssistantRunState;

  private lastNodeId: string | null = null;

  constructor(runId?: string) {
    this.state = {
      runId: runId || createId(),
      events: [],
      artifacts: new Map(),
      nodes: [],
      edges: [],
      conflicts: [],
    };
  }

  addArtifact(kind: AssistantRunArtifact['kind'], payload: unknown) {
    const artifact: AssistantRunArtifact = {
      id: createId(),
      kind,
      payload,
    };
    this.state.artifacts.set(artifact.id, artifact);
    return artifact.id;
  }

  addNode(label: string, phase: AssistantRunPhase, attempt: number) {
    const node: AssistantRunNode = {
      id: createId(),
      label,
      phase,
      status: 'pending',
      attempt,
    };
    this.state.nodes.push(node);
    return node;
  }

  startNode(nodeId: string) {
    const node = this.state.nodes.find((item) => item.id === nodeId);
    if (node) node.status = 'running';
  }

  completeNode(nodeId: string) {
    const node = this.state.nodes.find((item) => item.id === nodeId);
    if (node) node.status = 'completed';
  }

  failNode(nodeId: string) {
    const node = this.state.nodes.find((item) => item.id === nodeId);
    if (node) node.status = 'failed';
  }

  emit(
    type: AssistantRunEventType,
    phase: AssistantRunPhase,
    options?: {
      artifactRef?: string;
      payload?: Record<string, unknown>;
      nodeId?: string;
      previousNodeId?: string | null;
    }
  ) {
    const event: AssistantRunEvent = {
      id: createId(),
      runId: this.state.runId,
      type,
      phase,
      timestamp: new Date().toISOString(),
      artifactRef: options?.artifactRef,
      payload: options?.payload,
    };
    this.state.events.push(event);
    const fromNodeId = options?.previousNodeId ?? this.lastNodeId;
    if (fromNodeId && options?.nodeId) {
      this.state.edges.push({
        fromNodeId,
        toNodeId: options.nodeId,
        eventType: type,
      });
    }
    if (options?.nodeId) {
      this.lastNodeId = options.nodeId;
    }
    return event;
  }
}

export const executeAssistantRun = async (
  input: ExecuteAssistantRunInput
): Promise<ExecuteAssistantRunResult> => {
  const store = new AssistantRunStore(input.runId);
  const prompt = lastUserPrompt(input.messages);
  const requestArtifact = store.addArtifact('request_messages', input.messages);
  const requestNode = store.addNode('Run Requested', 'S0_INIT', 0);
  store.startNode(requestNode.id);
  input.onEvent?.(
    store.emit('RUN_REQUESTED', 'S0_INIT', {
      artifactRef: requestArtifact,
      nodeId: requestNode.id,
      payload: { messageCount: input.messages.length },
    })
  );
  store.completeNode(requestNode.id);

  const contextArtifact = store.addArtifact('workspace_context', input.contextText);
  const contextNode = store.addNode('Capture Context', 'S0_INIT', 0);
  store.startNode(contextNode.id);
  input.onEvent?.(
    store.emit('CONTEXT_CAPTURED', 'S0_INIT', {
      artifactRef: contextArtifact,
      nodeId: contextNode.id,
      payload: { chars: input.contextText.length },
    })
  );
  store.completeNode(contextNode.id);

  const planArtifact = store.addArtifact('execution_plan', buildExecutionPlan(prompt));
  const planNode = store.addNode('Build Plan', 'S1_ANALYSIS', 0);
  store.startNode(planNode.id);
  input.onEvent?.(
    store.emit('PLAN_READY', 'S1_ANALYSIS', {
      artifactRef: planArtifact,
      nodeId: planNode.id,
      payload: { summary: prompt || 'No prompt text' },
    })
  );
  store.completeNode(planNode.id);

  let combinedText = '';
  let finishReason: string | undefined;
  let usage: unknown;
  let attempt = 0;

  while (attempt <= input.maxRetries) {
    const executionNode = store.addNode('Execute Agent', 'S2_EXTRACTION', attempt + 1);
    store.startNode(executionNode.id);
    input.onEvent?.(
      store.emit('EXECUTION_STARTED', 'S2_EXTRACTION', {
        nodeId: executionNode.id,
        payload: { attempt: attempt + 1 },
      })
    );

    const systemPrompt =
      attempt === 0
        ? `${input.systemPrompt}\n\n${input.contextText}`
        : `${input.systemPrompt}\n\n${input.contextText}\n\nRetry context:\nResolve previous conflict(s) and apply only required edits for the original request.`;

    const execution = await runAgentExecution(
      {
        agent: input.agent,
        messages: input.messages,
        maxSteps: input.maxSteps,
        onDelta: input.onDelta,
      },
      systemPrompt
    );
    finishReason = execution.finishReason;
    usage = execution.usage;
    combinedText = combinedText
      ? `${combinedText}\n\n${execution.text}`.trim()
      : execution.text;

    const outputArtifact = store.addArtifact('execution_output', {
      attempt: attempt + 1,
      text: execution.text,
      finishReason: execution.finishReason,
    });
    input.onEvent?.(
      store.emit('EXECUTION_COMPLETED', 'S2_EXTRACTION', {
        artifactRef: outputArtifact,
        nodeId: executionNode.id,
        payload: { attempt: attempt + 1 },
      })
    );
    store.completeNode(executionNode.id);

    const validationNode = store.addNode('Validate Output', 'S3_SYNTHESIS', attempt + 1);
    store.startNode(validationNode.id);
    const conflicts = validateExecution(
      prompt,
      execution.text,
      input.collectChanges().length,
      executionNode.id
    );
    const validationArtifact = store.addArtifact('validation_report', {
      attempt: attempt + 1,
      conflicts,
    });
    if (!conflicts.length) {
      store.completeNode(validationNode.id);
      input.onEvent?.(
        store.emit('RUN_COMPLETED', 'S4_PRODUCTION', {
          artifactRef: validationArtifact,
          nodeId: validationNode.id,
          payload: { attempts: attempt + 1 },
        })
      );
      return {
        runId: store.state.runId,
        message: combinedText,
        finishReason,
        usage,
        events: store.state.events,
        artifacts: Array.from(store.state.artifacts.values()),
        dag: {
          nodes: store.state.nodes,
          edges: store.state.edges,
        },
        conflicts: store.state.conflicts,
      };
    }

    store.state.conflicts.push(...conflicts);
    for (const conflict of conflicts) {
      input.onEvent?.(
        store.emit('CONFLICT_FOUND', 'S3_SYNTHESIS', {
          artifactRef: validationArtifact,
          nodeId: validationNode.id,
          payload: {
            conflictId: conflict.id,
            severity: conflict.severity,
            message: conflict.message,
          },
        })
      );
    }

    if (attempt >= input.maxRetries) {
      store.failNode(validationNode.id);
      input.onEvent?.(
        store.emit('RUN_FAILED', 'S3_SYNTHESIS', {
          artifactRef: validationArtifact,
          nodeId: validationNode.id,
          payload: {
            attempts: attempt + 1,
            reason: 'Max retries reached',
          },
        })
      );
      return {
        runId: store.state.runId,
        message: combinedText,
        finishReason: finishReason || 'error',
        usage,
        events: store.state.events,
        artifacts: Array.from(store.state.artifacts.values()),
        dag: {
          nodes: store.state.nodes,
          edges: store.state.edges,
        },
        conflicts: store.state.conflicts,
      };
    }

    store.completeNode(validationNode.id);
    input.onEvent?.(
      store.emit('RETRY_REQUESTED', 'S3_SYNTHESIS', {
        nodeId: validationNode.id,
        payload: {
          attempt: attempt + 2,
          conflictIds: conflicts.map((item) => item.id),
        },
      })
    );
    attempt += 1;
  }

  return {
    runId: store.state.runId,
    message: combinedText,
    finishReason,
    usage,
    events: store.state.events,
    artifacts: Array.from(store.state.artifacts.values()),
    dag: {
      nodes: store.state.nodes,
      edges: store.state.edges,
    },
    conflicts: store.state.conflicts,
  };
};
