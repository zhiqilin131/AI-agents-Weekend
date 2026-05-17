import type { ReactNode } from 'react';
import { cn } from '../../app/components/ui/utils';
import { FlowConnector, ResilienceNodeCard } from './ResilienceNodeCard';
import { PIPELINE_STAGE_META, REQUEST_PATH, type ResilienceNodeId, type ResilienceScenario } from './resilienceModel';
import { innerCard } from './resilienceStyles';

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-600/80">
      {children}
    </p>
  );
}

const PIPELINE_ROW_1 = PIPELINE_STAGE_META.slice(0, 4);
const PIPELINE_ROW_2 = PIPELINE_STAGE_META.slice(4);

function PipelineStageRow({
  stages,
  scenario,
  selectedNode,
  onSelectNode,
}: {
  stages: typeof PIPELINE_STAGE_META;
  scenario: ResilienceScenario;
  selectedNode: ResilienceNodeId;
  onSelectNode: (id: ResilienceNodeId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-y-2">
      {stages.map((stage, i) => (
        <div key={stage.id} className="flex items-center">
          {i > 0 ? <FlowConnector direction="right" /> : null}
          <ResilienceNodeCard
            nodeId={stage.id}
            scenario={scenario}
            selected={selectedNode === stage.id}
            onSelect={() => onSelectNode(stage.id)}
            stageOrder={stage.order}
            layout="tile"
          />
        </div>
      ))}
    </div>
  );
}

export function ResilienceFlowDiagram({
  scenario,
  selectedNode,
  onSelectNode,
}: {
  scenario: ResilienceScenario;
  selectedNode: ResilienceNodeId;
  onSelectNode: (id: ResilienceNodeId) => void;
}) {
  return (
    <div
      className={cn(
        innerCard,
        'relative overflow-hidden bg-gradient-to-b from-violet-50/40 via-white to-white p-5 sm:p-8',
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgb(139 92 246 / 0.12) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center">
        <SectionLabel>Request → stream → trace</SectionLabel>
        <div className="flex flex-wrap items-center justify-center gap-y-2">
          {REQUEST_PATH.map((step, i) => (
            <div key={step.id} className="flex items-center">
              {i > 0 ? <FlowConnector direction="right" /> : null}
              <ResilienceNodeCard
                nodeId={step.id}
                scenario={scenario}
                selected={selectedNode === step.id}
                onSelect={() => onSelectNode(step.id)}
                caption={step.caption}
                layout="wide"
              />
            </div>
          ))}
        </div>

        <FlowConnector />

        <SectionLabel>Decision pipeline · pipeline.py</SectionLabel>
        <div className="mx-auto w-full max-w-3xl space-y-1 pb-1">
          <PipelineStageRow
            stages={PIPELINE_ROW_1}
            scenario={scenario}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
          />
          <div className="flex justify-center py-0.5">
            <FlowConnector />
          </div>
          <PipelineStageRow
            stages={PIPELINE_ROW_2}
            scenario={scenario}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
          />
        </div>

        <FlowConnector />

        <SectionLabel>Guards &amp; dependencies</SectionLabel>
        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-2xl border border-violet-100 bg-white/90 p-3 shadow-sm">
            <p className="text-center text-[10px] font-bold uppercase tracking-wide text-gray-500">Guards</p>
            <ResilienceNodeCard
              nodeId="circuit"
              scenario={scenario}
              selected={selectedNode === 'circuit'}
              onSelect={() => onSelectNode('circuit')}
              layout="compact"
            />
            <ResilienceNodeCard
              nodeId="chaos"
              scenario={scenario}
              selected={selectedNode === 'chaos'}
              onSelect={() => onSelectNode('chaos')}
              layout="compact"
            />
          </div>

          <div className="space-y-2 rounded-2xl border border-violet-100 bg-white/90 p-3 shadow-sm">
            <p className="text-center text-[10px] font-bold uppercase tracking-wide text-gray-500">LLM stack</p>
            <ResilienceNodeCard
              nodeId="llm_gateway"
              scenario={scenario}
              selected={selectedNode === 'llm_gateway'}
              onSelect={() => onSelectNode('llm_gateway')}
              layout="compact"
            />
            <div className="grid grid-cols-2 gap-2">
              <ResilienceNodeCard
                nodeId="llm_primary"
                scenario={scenario}
                selected={selectedNode === 'llm_primary'}
                onSelect={() => onSelectNode('llm_primary')}
                layout="compact"
              />
              <ResilienceNodeCard
                nodeId="llm_fallback"
                scenario={scenario}
                selected={selectedNode === 'llm_fallback'}
                onSelect={() => onSelectNode('llm_fallback')}
                layout="compact"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid w-full max-w-md grid-cols-2 gap-2">
          <ResilienceNodeCard
            nodeId="tavily"
            scenario={scenario}
            selected={selectedNode === 'tavily'}
            onSelect={() => onSelectNode('tavily')}
            layout="compact"
          />
          <ResilienceNodeCard
            nodeId="linear_mcp"
            scenario={scenario}
            selected={selectedNode === 'linear_mcp'}
            onSelect={() => onSelectNode('linear_mcp')}
            layout="compact"
          />
        </div>

        <p className="mt-5 max-w-lg text-center text-[11px] leading-relaxed text-gray-500">
          Tavily is only called at <strong className="text-gray-700">retrieve</strong>. LLM stages route through{' '}
          <strong className="text-gray-700">llm_gateway</strong> with primary → secondary failover.
        </p>
      </div>
    </div>
  );
}
