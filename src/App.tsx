/**
 * SkyOps Agent V1 - Operational Inspector & Runtime Monitor
 *
 * Dedicated local inspector interface for observing the running SkyOps Agent:
 * - Real-time Subsystem Health (Runtime, Kubernetes, Queue/Spool, Transport, Watchers)
 * - Kubernetes Discovered Topology (Nodes, Pods, Deployments, Events)
 * - Detected Abnormal Signals (CrashLoopBackOff, OOMKilled, ImagePullBackOff, etc.)
 * - Durable Spool & Persistent Queue metrics
 * - Normalized Evidence payload inspector with secret redaction verification
 * - Fault injection to demonstrate autonomous detection and queue resilience
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Server,
  Database,
  Radio,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  HardDrive,
  Cpu,
  RefreshCw,
  Terminal,
  Zap,
  Eye,
} from 'lucide-react';

interface SimulatedPod {
  namespace: string;
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  node: string;
  container: string;
  image: string;
  failureReason?: string;
  exitCode?: number;
}

interface DetectedSignal {
  id: string;
  timestamp: string;
  type: string;
  severity: 'CRITICAL' | 'ERROR' | 'WARN' | 'INFO';
  summary: string;
  resource: string;
  reason: string;
  fingerprint: string;
  correlation: Record<string, string>;
  rawObservation: Record<string, unknown>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'topology' | 'signals' | 'spool' | 'config'>('topology');
  const [selectedSignal, setSelectedSignal] = useState<DetectedSignal | null>(null);
  const [uptimeSeconds, setUptimeSeconds] = useState(142);
  const [queueDepth, setQueueDepth] = useState(3);
  const [spoolDiskBytes, setSpoolDiskBytes] = useState(4820);
  const [uploadedCount, setUploadedCount] = useState(28);
  const [isDraining, setIsDraining] = useState(false);

  // Agent Identity
  const identity = {
    agentId: 'skyops-agent-a49e21df-6b80-4968-a28d-1941cbfad468',
    installationId: 'inst-78d10b7f-3829-41e9-9fae-64d8a178bc12',
    organizationId: 'org-production-core',
    environmentId: 'env-us-east-prod',
    clusterName: 'production-gke-primary',
    version: '1.0.0',
    mode: 'Kubernetes Dedicated Agent',
  };

  // Subsystems Health
  const components = [
    { name: 'Agent Runtime', key: 'runtime', status: 'healthy', msg: 'Core state machine active (RUNNING)' },
    { name: 'Kubernetes Client', key: 'k8s', status: 'healthy', msg: 'Connected to API Server (v1.30.2)' },
    { name: 'Persistent Queue', key: 'queue', status: 'healthy', msg: 'Disk spool mounted at /var/lib/skyops/spool' },
    { name: 'Transport Layer', key: 'transport', status: 'healthy', msg: 'mTLS outbound link to SkyOps Cloud' },
    { name: 'Pod Stream Watcher', key: 'watch-pods', status: 'healthy', msg: 'Delta streaming 0 drops' },
    { name: 'Cluster Event Watcher', key: 'watch-events', status: 'healthy', msg: 'Active event filtering enabled' },
  ];

  // Discovered Nodes
  const nodes = [
    { name: 'gke-prod-pool-1-a1b2', status: 'Ready', cpu: '8 vCPU', mem: '32 GiB', version: 'v1.30.2', os: 'Container-Optimized OS' },
    { name: 'gke-prod-pool-1-c3d4', status: 'Ready', cpu: '8 vCPU', mem: '32 GiB', version: 'v1.30.2', os: 'Container-Optimized OS' },
    { name: 'gke-prod-pool-2-e5f6', status: 'Ready', cpu: '16 vCPU', mem: '64 GiB', version: 'v1.30.2', os: 'Container-Optimized OS' },
  ];

  // Discovered Pods & Live State
  const [pods, setPods] = useState<SimulatedPod[]>([
    {
      namespace: 'payments',
      name: 'payments-api-6b79f8c4-w7v9x',
      phase: 'Running',
      ready: false,
      restarts: 8,
      node: 'gke-prod-pool-1-a1b2',
      container: 'payment-gateway',
      image: 'registry.internal.io/payments-api:v42',
      failureReason: 'CrashLoopBackOff',
      exitCode: 137,
    },
    {
      namespace: 'payments',
      name: 'checkout-frontend-7f99b4d8-z2m4p',
      phase: 'Running',
      ready: true,
      restarts: 0,
      node: 'gke-prod-pool-1-c3d4',
      container: 'web',
      image: 'registry.internal.io/checkout:v19',
    },
    {
      namespace: 'orders',
      name: 'order-dispatch-55c687fb-l9k1r',
      phase: 'Pending',
      ready: false,
      restarts: 0,
      node: 'gke-prod-pool-2-e5f6',
      container: 'dispatcher',
      image: 'registry.internal.io/orders:v12-bad',
      failureReason: 'ImagePullBackOff',
    },
    {
      namespace: 'infra',
      name: 'skyops-agent-daemon-9f22c',
      phase: 'Running',
      ready: true,
      restarts: 0,
      node: 'gke-prod-pool-1-a1b2',
      container: 'skyops-agent',
      image: 'skyops/agent:1.0.0',
    },
  ]);

  // Detected Signals / Evidence
  const [signals, setSignals] = useState<DetectedSignal[]>([
    {
      id: 'ev-a9128f-crashloop',
      timestamp: new Date(Date.now() - 45000).toISOString(),
      type: 'CrashLoopBackOff',
      severity: 'CRITICAL',
      summary: 'Container payment-gateway in pod payments-api-6b79f8c4-w7v9x is in CrashLoopBackOff (8 restarts)',
      resource: 'k8s:payments:pod/payments-api-6b79f8c4-w7v9x',
      reason: 'CrashLoopBackOff',
      fingerprint: '3f98a12e8b',
      correlation: {
        cluster: 'production-gke-primary',
        namespace: 'payments',
        pod: 'payments-api-6b79f8c4-w7v9x',
        container: 'payment-gateway',
        node: 'gke-prod-pool-1-a1b2',
      },
      rawObservation: {
        exitCode: 137,
        signal: 'SIGKILL',
        kernelReason: 'OOMKilled',
        memoryLimitBytes: 536870912,
        restartCount: 8,
      },
    },
    {
      id: 'ev-b4819a-oomkilled',
      timestamp: new Date(Date.now() - 120000).toISOString(),
      type: 'OOMKilled',
      severity: 'CRITICAL',
      summary: 'Linux OOMKiller terminated container payment-gateway (Exit Code 137)',
      resource: 'k8s:payments:pod/payments-api-6b79f8c4-w7v9x',
      reason: 'OOMKilled',
      fingerprint: '71c8991f24',
      correlation: {
        cluster: 'production-gke-primary',
        namespace: 'payments',
        pod: 'payments-api-6b79f8c4-w7v9x',
      },
      rawObservation: {
        lastState: 'terminated',
        exitCode: 137,
        memoryUsageAtKill: '512MiB',
      },
    },
    {
      id: 'ev-c1284d-imagepull',
      timestamp: new Date(Date.now() - 210000).toISOString(),
      type: 'ImagePullFailure',
      severity: 'ERROR',
      summary: 'Back-off pulling image registry.internal.io/orders:v12-bad: manifest not found',
      resource: 'k8s:orders:pod/order-dispatch-55c687fb-l9k1r',
      reason: 'ImagePullBackOff',
      fingerprint: '992a71bf03',
      correlation: {
        cluster: 'production-gke-primary',
        namespace: 'orders',
        pod: 'order-dispatch-55c687fb-l9k1r',
      },
      rawObservation: {
        image: 'registry.internal.io/orders:v12-bad',
        pullAttempts: 4,
        kubeletError: 'rpc error: code = NotFound desc = image manifest unknown',
      },
    },
  ]);

  // Tick uptime counter
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Simulate manual fault injection to showcase agent detection
  const injectFault = (type: 'OOM' | 'CrashLoop' | 'ImagePull') => {
    const now = new Date().toISOString();
    const newPodName = `simulated-svc-${Math.random().toString(36).substring(2, 6)}`;

    let newSignal: DetectedSignal;
    if (type === 'OOM') {
      newSignal = {
        id: `ev-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: now,
        type: 'OOMKilled',
        severity: 'CRITICAL',
        summary: `Container worker in pod ${newPodName} terminated by Linux kernel OOMKiller (Exit code 137)`,
        resource: `k8s:production:pod/${newPodName}`,
        reason: 'OOMKilled',
        fingerprint: Math.random().toString(16).substring(2, 10),
        correlation: {
          cluster: identity.clusterName,
          namespace: 'production',
          pod: newPodName,
          container: 'worker',
        },
        rawObservation: {
          exitCode: 137,
          signal: 'SIGKILL',
          memoryBreached: '1024MiB',
        },
      };
    } else if (type === 'CrashLoop') {
      newSignal = {
        id: `ev-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: now,
        type: 'CrashLoopBackOff',
        severity: 'CRITICAL',
        summary: `Container api-backend in pod ${newPodName} is in CrashLoopBackOff (Restart count: 4)`,
        resource: `k8s:production:pod/${newPodName}`,
        reason: 'CrashLoopBackOff',
        fingerprint: Math.random().toString(16).substring(2, 10),
        correlation: {
          cluster: identity.clusterName,
          namespace: 'production',
          pod: newPodName,
        },
        rawObservation: {
          restartCount: 4,
          lastExitCode: 1,
          backoffSeconds: 80,
        },
      };
    } else {
      newSignal = {
        id: `ev-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: now,
        type: 'ImagePullFailure',
        severity: 'ERROR',
        summary: `Container frontend in pod ${newPodName} failed image pull: authorization denied`,
        resource: `k8s:production:pod/${newPodName}`,
        reason: 'ErrImagePull',
        fingerprint: Math.random().toString(16).substring(2, 10),
        correlation: {
          cluster: identity.clusterName,
          namespace: 'production',
          pod: newPodName,
        },
        rawObservation: {
          image: 'registry.internal.io/private-repo:latest',
          reason: 'ErrImagePull',
        },
      };
    }

    setSignals((prev) => [newSignal, ...prev]);
    setQueueDepth((prev) => prev + 1);
    setSpoolDiskBytes((prev) => prev + 1240);

    // Add to pods list
    setPods((prev) => [
      {
        namespace: 'production',
        name: newPodName,
        phase: 'Running',
        ready: false,
        restarts: type === 'CrashLoop' ? 4 : 1,
        node: 'gke-prod-pool-1-a1b2',
        container: 'worker',
        image: 'registry.internal.io/worker:v1',
        failureReason: type === 'OOM' ? 'OOMKilled' : type === 'CrashLoop' ? 'CrashLoopBackOff' : 'ImagePullBackOff',
        exitCode: type === 'OOM' ? 137 : 1,
      },
      ...prev,
    ]);
  };

  // Simulate queue flush / upload
  const triggerFlush = () => {
    if (queueDepth === 0) return;
    setIsDraining(true);
    setTimeout(() => {
      setUploadedCount((prev) => prev + queueDepth);
      setQueueDepth(0);
      setSpoolDiskBytes(0);
      setIsDraining(false);
    }, 600);
  };

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased p-4 md:p-8">
      {/* Top Banner: Identity & Status */}
      <header className="max-w-7xl mx-auto mb-8 border border-slate-800 rounded-xl bg-slate-900/80 backdrop-blur p-6 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Activity className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">SkyOps Agent</h1>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  v{identity.version}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  OPERATIONAL
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                {identity.mode} &bull; Autonomous Evidence & Incident Detection
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
              <span className="text-slate-400">Uptime: </span>
              <span className="font-mono text-slate-200 font-semibold">{formatUptime(uptimeSeconds)}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
              <span className="text-slate-400">Cluster: </span>
              <span className="font-mono text-cyan-400">{identity.clusterName}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50">
              <span className="text-slate-400">Env: </span>
              <span className="font-mono text-emerald-400">{identity.environmentId}</span>
            </div>
          </div>
        </div>

        {/* Identity Details Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-5 pt-1 text-xs">
          <div>
            <div className="text-slate-400 text-[11px] uppercase tracking-wider mb-1">Persistent Agent ID</div>
            <div className="font-mono text-slate-300 truncate bg-slate-950/60 px-2 py-1 rounded border border-slate-800" title={identity.agentId}>
              {identity.agentId}
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px] uppercase tracking-wider mb-1">Installation ID</div>
            <div className="font-mono text-slate-300 truncate bg-slate-950/60 px-2 py-1 rounded border border-slate-800" title={identity.installationId}>
              {identity.installationId}
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px] uppercase tracking-wider mb-1">Queue & Disk Spool</div>
            <div className="flex items-center gap-2">
              <div className="font-mono text-amber-400 font-semibold">{queueDepth} pending</div>
              <span className="text-slate-400">({(spoolDiskBytes / 1024).toFixed(1)} KB on disk)</span>
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[11px] uppercase tracking-wider mb-1">Cloud Deliveries</div>
            <div className="font-mono text-emerald-400 font-semibold">{uploadedCount} batches acknowledged</div>
          </div>
        </div>
      </header>

      {/* Subsystem Health Matrix */}
      <section className="max-w-7xl mx-auto mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-400" />
          Component Health & Architecture
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {components.map((comp) => (
            <div
              key={comp.key}
              className="border border-slate-800/80 bg-slate-900/50 rounded-lg p-3.5 flex items-start gap-3 hover:border-slate-700 transition"
            >
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-200">{comp.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">{comp.msg}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Interactive Work Area */}
      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Navigation & Content (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <button
              onClick={() => setActiveTab('topology')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeTab === 'topology'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              Discovered Topology ({pods.length} pods, {nodes.length} nodes)
            </button>
            <button
              onClick={() => setActiveTab('signals')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeTab === 'signals'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Detected Signals ({signals.length})
            </button>
            <button
              onClick={() => setActiveTab('spool')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeTab === 'spool'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" />
              Persistent Queue / Spool
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeTab === 'config'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              Config & Security
            </button>
          </div>

          {/* TAB 1: KUBERNETES TOPOLOGY */}
          {activeTab === 'topology' && (
            <div className="flex flex-col gap-6">
              {/* Nodes Section */}
              <div className="border border-slate-800 rounded-xl bg-slate-900/50 p-4">
                <h3 className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-cyan-400" />
                  Discovered Cluster Nodes
                </h3>
                <div className="divide-y divide-slate-800/80">
                  {nodes.map((node) => (
                    <div key={node.name} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-mono text-slate-200 font-medium">{node.name}</div>
                        <div className="text-slate-400 text-[11px] mt-0.5">
                          {node.cpu} &bull; {node.mem} &bull; {node.os}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {node.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pods Section */}
              <div className="border border-slate-800 rounded-xl bg-slate-900/50 p-4">
                <h3 className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Server className="h-4 w-4 text-indigo-400" />
                  Monitored Pods & Health
                </h3>
                <div className="divide-y divide-slate-800/80">
                  {pods.map((pod) => (
                    <div key={pod.name} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                            {pod.namespace}
                          </span>
                          <span className="font-mono text-slate-200 font-semibold">{pod.name}</span>
                        </div>
                        <div className="text-slate-400 text-[11px] font-mono mt-1">
                          Image: {pod.image} &bull; Node: {pod.node}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-start md:self-auto">
                        {pod.failureReason ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {pod.failureReason}
                            {pod.restarts > 0 && ` (${pod.restarts} restarts)`}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Running (Ready)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DETECTED SIGNALS */}
          {activeTab === 'signals' && (
            <div className="border border-slate-800 rounded-xl bg-slate-900/50 p-4">
              <h3 className="text-xs font-semibold text-slate-300 mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Normalized Signals Detected in Cluster
                </span>
                <span className="text-[11px] text-slate-400">Click signal to view JSON evidence</span>
              </h3>

              <div className="flex flex-col gap-3">
                {signals.map((sig) => (
                  <div
                    key={sig.id}
                    onClick={() => setSelectedSignal(sig)}
                    className={`p-3.5 rounded-lg border text-xs cursor-pointer transition ${
                      selectedSignal?.id === sig.id
                        ? 'border-indigo-500 bg-indigo-950/30'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            sig.severity === 'CRITICAL'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {sig.severity}
                        </span>
                        <span className="font-mono font-semibold text-slate-200">{sig.type}</span>
                      </div>
                      <span className="text-slate-400 text-[11px] font-mono flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(sig.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="text-slate-300 mb-2">{sig.summary}</div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                      <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        Resource: {sig.resource}
                      </span>
                      <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        FP: {sig.fingerprint}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: PERSISTENT QUEUE & SPOOL */}
          {activeTab === 'spool' && (
            <div className="border border-slate-800 rounded-xl bg-slate-900/50 p-5 text-xs flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-slate-200 font-semibold">
                  <Database className="h-4 w-4 text-amber-400" />
                  Durable Local Spool Engine
                </div>
                <button
                  onClick={triggerFlush}
                  disabled={isDraining || queueDepth === 0}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isDraining ? 'animate-spin' : ''}`} />
                  {isDraining ? 'Draining to Cloud...' : 'Flush to SkyOps Cloud'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">In-Memory Queue Depth</div>
                  <div className="text-xl font-bold font-mono text-amber-400 mt-1">{queueDepth}</div>
                  <div className="text-[10px] text-slate-400 mt-1">Bounded at 5,000 items</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">Spool Disk Usage</div>
                  <div className="text-xl font-bold font-mono text-cyan-400 mt-1">
                    {(spoolDiskBytes / 1024).toFixed(1)} KB
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Max Quota: 500 MB</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px]">Delivery Acknowledgements</div>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-1">{uploadedCount}</div>
                  <div className="text-[10px] text-slate-400 mt-1">0 dropped or orphaned</div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300">
                <div className="text-slate-400 mb-2 font-sans font-semibold">Resilience Guarantees:</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-400">
                  <li>Atomic writes with temporary files prevent partial disk corruption on pod termination</li>
                  <li>Automatic FIFO batch recovery discovers pending records upon container restart</li>
                  <li>Deduplication fingerprints prevent alert storming and queue bloating</li>
                  <li>Exponential backoff with randomized jitter prevents thundering herds on cloud reconnect</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 4: CONFIG & SECURITY */}
          {activeTab === 'config' && (
            <div className="border border-slate-800 rounded-xl bg-slate-900/50 p-5 text-xs flex flex-col gap-4">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                Sanitized Runtime Configuration & Secret Redaction
              </h3>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto">
                <pre>{JSON.stringify({
                  organizationId: identity.organizationId,
                  environmentId: identity.environmentId,
                  agentId: identity.agentId,
                  kubernetes: {
                    clusterName: identity.clusterName,
                    inCluster: true,
                    discoveryIntervalSeconds: 300,
                    collectionIntervalSeconds: 15,
                  },
                  transport: {
                    apiUrl: "https://api.skyops.io",
                    agentToken: "skyops_sec_...999 [AUTOMATICALLY REDACTED]",
                    timeoutMs: 15000,
                    heartbeatIntervalSeconds: 30,
                    batchSize: 50,
                  },
                  security: {
                    secretRedactionEnabled: true,
                    tlsVerificationEnabled: true,
                    logLevel: "INFO",
                  },
                }, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Fault Injection & Raw Evidence Inspector (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Fault Injector Panel */}
          <div className="border border-slate-800 rounded-xl bg-slate-900/70 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Simulate Kubernetes Failure
            </h3>
            <p className="text-[11px] text-slate-400 mb-3">
              Trigger realistic cluster failure signals to observe detection, normalization, and persistent queueing:
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => injectFault('CrashLoop')}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-left text-xs font-medium text-slate-200 transition flex items-center justify-between"
              >
                <span>Trigger CrashLoopBackOff</span>
                <span className="text-[10px] text-rose-400 font-mono">Exit Code 1</span>
              </button>

              <button
                onClick={() => injectFault('OOM')}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-left text-xs font-medium text-slate-200 transition flex items-center justify-between"
              >
                <span>Trigger OOMKilled</span>
                <span className="text-[10px] text-rose-400 font-mono">Exit Code 137</span>
              </button>

              <button
                onClick={() => injectFault('ImagePull')}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-left text-xs font-medium text-slate-200 transition flex items-center justify-between"
              >
                <span>Trigger ImagePullBackOff</span>
                <span className="text-[10px] text-amber-400 font-mono">Manifest 404</span>
              </button>
            </div>
          </div>

          {/* Raw Evidence Payload Inspector */}
          <div className="border border-slate-800 rounded-xl bg-slate-900/70 p-4 flex-1 flex flex-col">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-2">
              <Eye className="h-4 w-4 text-indigo-400" />
              Normalized Evidence Inspector
            </h3>

            {selectedSignal ? (
              <div className="flex-1 flex flex-col">
                <div className="text-[11px] text-slate-400 mb-2 font-mono">
                  ID: <span className="text-slate-200">{selectedSignal.id}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-300 overflow-y-auto max-h-[360px] flex-1">
                  <pre>{JSON.stringify({
                    evidenceId: selectedSignal.id,
                    timestamp: selectedSignal.timestamp,
                    source: "kubernetes",
                    kind: "SIGNAL",
                    severity: selectedSignal.severity,
                    resourceId: selectedSignal.resource,
                    evidenceType: "SIGNAL_DETECTED",
                    observation: {
                      summary: selectedSignal.summary,
                      reason: selectedSignal.reason,
                      details: selectedSignal.rawObservation,
                    },
                    metadata: {
                      collector: "kubernetes-detector",
                      fingerprint: selectedSignal.fingerprint,
                    },
                    correlationKeys: selectedSignal.correlation,
                  }, null, 2)}</pre>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800 rounded-lg text-slate-400 text-xs">
                <Radio className="h-8 w-8 text-slate-600 mb-2" />
                Select any detected signal to inspect its normalized evidence schema
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
