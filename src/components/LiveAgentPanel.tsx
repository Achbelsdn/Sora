import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import type { AgentStream } from '../hooks/use-agent-stream';

const AGENT_META: Record<string, { label: string; icon: string; color: string }> = {
  researcher:  { label: 'Agent 1',  icon: '🔍', color: '#1a4a8b' },
  architect:   { label: 'Agent 2',   icon: '🏗️', color: '#1a7a4a' },
  critic:      { label: 'Agent 3',      icon: '⚡', color: '#8b1a1a' },
  synthesizer: { label: 'Agent 4', icon: '✦',  color: '#7a4a0a' },
  llama:       { label: 'LLaMA',       icon: '🦙', color: '#1a0e08' },
  gemini:      { label: 'Gemini',      icon: '💎', color: '#1a4a8b' },
  openrouter:  { label: 'OpenRouter',  icon: '🌐', color: '#5a2a8a' },
};

function AgentDot({ color, animate }: { color: string; animate: boolean }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: `radial-gradient(circle at 40% 35%, ${color}88, ${color})`,
      boxShadow: animate ? `0 0 12px ${color}50` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: animate ? 'dot-pulse 1.4s ease-in-out infinite' : 'none',
      transition: 'all 0.3s ease',
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: 'rgba(255,255,255,0.4)',
        transform: 'translate(-2px, -2px)',
      }} />
    </div>
  );
}

function AgentCard({ agent, expanded, onToggle }: {
  agent: AgentStream; expanded: boolean; onToggle: () => void;
}) {
  const meta = AGENT_META[agent.id] ?? { label: agent.id, icon: '⚙️', color: '#888' };
  const isActive = agent.status === 'streaming';
  const isDone = agent.status === 'done';
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll content as it streams
  useEffect(() => {
    if (contentRef.current && isActive) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [agent.content, isActive]);

  const duration = agent.startedAt
    ? ((agent.doneAt ?? Date.now()) - agent.startedAt) / 1000
    : 0;

  return (
    <div
      className="anim-up"
      style={{
        borderRadius: 14,
        border: `1px solid ${isActive ? meta.color + '40' : isDone ? meta.color + '20' : 'var(--border)'}`,
        background: isActive ? meta.color + '06' : 'var(--surface)',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        boxShadow: isActive ? `0 0 20px ${meta.color}10` : 'var(--shadow-xs)',
      }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', border: 'none', cursor: 'pointer',
          background: 'transparent', fontFamily: 'var(--f-body)',
        }}
      >
        <AgentDot color={meta.color} animate={isActive} />
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? meta.color : isDone ? 'var(--ink2)' : 'var(--ink3)' }}>
              {meta.label}
            </span>
            {isActive && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: meta.color + '15', color: meta.color,
                fontFamily: 'var(--f-mono)', fontWeight: 600,
                animation: 'chip-pulse 1.5s ease infinite',
              }}>
                thinking…
              </span>
            )}
            {isDone && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: 'var(--green-s)', color: 'var(--green)',
                fontFamily: 'var(--f-mono)', fontWeight: 600,
              }}>
                done · {duration.toFixed(1)}s
              </span>
            )}
          </div>
          {/* Preview line */}
          {agent.content && !expanded && (
            <p style={{
              fontSize: 11, color: 'var(--ink3)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'var(--f-mono)', maxWidth: '100%',
            }}>
              {agent.content.slice(0, 120)}…
            </p>
          )}
        </div>
        <span style={{
          fontSize: 11, color: 'var(--ink4)',
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }}>▾</span>
      </button>

      {/* Expandable content */}
      {expanded && agent.content && (
        <div
          ref={contentRef}
          style={{
            maxHeight: 300, overflowY: 'auto',
            padding: '0 14px 14px',
            borderTop: `1px solid ${meta.color}15`,
          }}
        >
          <div
            className="sara-md"
            style={{ fontSize: 12, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: marked.parse(agent.content) as string }}
          />
          {/* Typing cursor */}
          {isActive && (
            <span style={{
              display: 'inline-block', width: 8, height: 16,
              background: meta.color, borderRadius: 2,
              animation: 'type-cursor 0.8s step-end infinite',
              marginLeft: 2, verticalAlign: 'text-bottom',
            }} />
          )}
        </div>
      )}

      {/* Progress bar */}
      {isActive && (
        <div style={{ height: 2, background: meta.color + '15' }}>
          <div style={{
            height: '100%', background: meta.color,
            animation: 'shimmer 1.5s ease infinite',
            backgroundSize: '200% 100%',
            backgroundImage: `linear-gradient(90deg, ${meta.color}40, ${meta.color}, ${meta.color}40)`,
          }} />
        </div>
      )}
    </div>
  );
}

export default function LiveAgentPanel({ agents, phase, elapsed, streaming }: {
  agents: Record<string, AgentStream>;
  phase: string;
  elapsed: number;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const agentList = Object.values(agents);

  // Auto-expand active agents
  useEffect(() => {
    for (const a of agentList) {
      if (a.status === 'streaming') {
        setExpanded(p => ({ ...p, [a.id]: true }));
      }
    }
  }, [agentList.map(a => a.status).join(',')]);

  if (!streaming && agentList.length === 0) return null;

  const activeCount = agentList.filter(a => a.status === 'streaming').length;
  const doneCount = agentList.filter(a => a.status === 'done').length;

  return (
    <div className="anim-up" style={{ marginBottom: 16 }}>
      {/* Header bar — like the screenshot */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 10, padding: '0 4px',
      }}>
        {/* Agent dots cluster */}
        <div style={{ display: 'flex', marginLeft: -4 }}>
          {agentList.slice(0, 4).map((a, i) => {
            const meta = AGENT_META[a.id];
            return (
              <div key={a.id} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: `radial-gradient(circle at 40% 35%, ${meta?.color ?? '#888'}88, ${meta?.color ?? '#888'})`,
                border: '2px solid var(--surface)',
                marginLeft: i > 0 ? -8 : 0,
                zIndex: agentList.length - i,
                animation: a.status === 'streaming' ? 'dot-pulse 1.4s ease-in-out infinite' : 'none',
              }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', margin: '4px 0 0 5px' }} />
              </div>
            );
          })}
        </div>

        <span style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 500 }}>
          {activeCount > 0
            ? `Les agents réfléchissent`
            : doneCount === agentList.length && agentList.length > 0
              ? 'Agents done'
              : 'Initializing…'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink4)', fontFamily: 'var(--f-mono)' }}>
          • {elapsed}s
        </span>
        {activeCount > 0 && (
          <span style={{
            fontSize: 11, color: 'var(--ink4)',
            marginLeft: 'auto',
            animation: 'fade-in 0.3s ease',
          }}>
            ›
          </span>
        )}
      </div>

      {/* Agent cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {agentList.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            expanded={!!expanded[agent.id]}
            onToggle={() => setExpanded(p => ({ ...p, [agent.id]: !p[agent.id] }))}
          />
        ))}
      </div>
    </div>
  );
}