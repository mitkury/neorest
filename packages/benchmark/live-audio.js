import { createServer as createProbeServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import wrtc from '@roamhq/wrtc';
import WebSocket from 'ws';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';

const SAMPLE_RATE = 48_000;
const FRAME_MS = 10;
const FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1_000;
const SOURCE_WARMUP_MS = 750;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const mediaProfiles = Object.freeze({
  clean: { delayMs: 0, jitterMs: 0, lossPercent: 0 },
  degraded: { delayMs: 80, jitterMs: 25, lossPercent: 3 },
  severe: { delayMs: 180, jitterMs: 80, lossPercent: 8 },
});

function usage() {
  return `Neorest live audio loopback benchmark

Usage:
  npm run test:live-audio -- [options]

Options:
  --profile clean|degraded|severe  Server media impairment preset (default: clean)
  --input path.wav                 Use a PCM 16-bit WAV instead of generated audio
  --duration seconds              Generated audio duration (default: 5)
  --runs count                    Repeat and aggregate results (default: 1)
  --output directory              Artifact directory
  --delay-ms number               Override server echo delay
  --jitter-ms number              Override server echo jitter
  --loss-percent number           Override server echo frame loss
  --help                          Show this help

The media impairment presets work without Docker and are intentionally applied
between the server audio sink and source. Use test:live-audio:network to impair
the actual WebSocket and WebRTC packets in a Linux container.`;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      values.help = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const [name, inlineValue] = argument.slice(2).split('=', 2);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }
    values[name] = value;
  }

  const profileName = String(values.profile || 'clean');
  const profile = mediaProfiles[profileName];
  if (!profile) throw new Error(`Unknown profile: ${profileName}`);
  const number = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    if (values[name] === undefined) return fallback;
    const parsed = Number(values[name]);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`--${name} must be between ${min} and ${max}`);
    }
    return parsed;
  };

  return {
    help: values.help === true,
    profileName,
    input: values.input ? resolve(String(values.input)) : null,
    durationSeconds: number('duration', 5, { min: 1, max: 30 }),
    runs: Math.floor(number('runs', 1, { min: 1, max: 20 })),
    output: values.output ? resolve(String(values.output)) : null,
    impairment: {
      delayMs: number('delay-ms', profile.delayMs, { max: 5_000 }),
      jitterMs: number('jitter-ms', profile.jitterMs, { max: 5_000 }),
      lossPercent: number('loss-percent', profile.lossPercent, { max: 100 }),
    },
  };
}

function installWebRtcGlobals() {
  const globals = {
    WebSocket,
    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCIceCandidate: wrtc.RTCIceCandidate,
    RTCSessionDescription: wrtc.RTCSessionDescription,
    MediaStream: wrtc.MediaStream,
    MediaStreamTrack: wrtc.MediaStreamTrack,
  };
  for (const [name, value] of Object.entries(globals)) {
    if (value) Object.defineProperty(globalThis, name, { configurable: true, value });
  }
}

function createGeneratedAudio(durationSeconds) {
  const length = Math.round(durationSeconds * SAMPLE_RATE);
  const samples = new Int16Array(length);
  const markerStart = Math.round(0.4 * SAMPLE_RATE);
  const markerLength = Math.round(0.12 * SAMPLE_RATE);

  for (let index = 0; index < markerLength && markerStart + index < length; index += 1) {
    const progress = index / markerLength;
    const seconds = index / SAMPLE_RATE;
    const sweepRate = 3_000 / (markerLength / SAMPLE_RATE);
    const phase = 2 * Math.PI * (650 * seconds + 0.5 * sweepRate * seconds ** 2);
    const envelope = Math.sin(Math.PI * progress) ** 2;
    samples[markerStart + index] = Math.round(
      0.82 * 32767 * envelope * Math.sin(phase),
    );
  }

  const voiceStart = markerStart + markerLength + Math.round(0.18 * SAMPLE_RATE);
  const voiceEnd = Math.max(voiceStart, length - Math.round(0.4 * SAMPLE_RATE));
  for (let index = voiceStart; index < voiceEnd; index += 1) {
    const time = (index - voiceStart) / SAMPLE_RATE;
    const phrasePosition = time % 1.2;
    if (phrasePosition > 0.94) continue;
    const envelope = Math.min(1, phrasePosition / 0.04, (0.94 - phrasePosition) / 0.06);
    const fundamental = 145 + 28 * Math.sin(2 * Math.PI * 0.7 * time);
    const voiced = (
      Math.sin(2 * Math.PI * fundamental * time)
      + 0.43 * Math.sin(2 * Math.PI * fundamental * 2 * time)
      + 0.2 * Math.sin(2 * Math.PI * fundamental * 3 * time)
      + 0.12 * Math.sin(2 * Math.PI * 920 * time)
    );
    samples[index] = Math.round(0.28 * 32767 * Math.max(0, envelope) * voiced / 1.75);
  }

  return { samples, sampleRate: SAMPLE_RATE, markerStart, markerLength };
}

function findChunk(buffer, name) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkName = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunkName === name) return { offset: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
  return null;
}

function resampleLinear(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) return samples;
  const output = new Int16Array(Math.round(samples.length * targetRate / sourceRate));
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * sourceRate / targetRate;
    const left = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const right = Math.min(samples.length - 1, left + 1);
    const mix = sourcePosition - left;
    output[index] = Math.round(samples[left] * (1 - mix) + samples[right] * mix);
  }
  return output;
}

async function readPcmWav(path) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Input audio must be a RIFF/WAVE file');
  }
  const format = findChunk(buffer, 'fmt ');
  const data = findChunk(buffer, 'data');
  if (!format || !data || format.size < 16) throw new Error('Input WAV is missing fmt or data');
  const encoding = buffer.readUInt16LE(format.offset);
  const channels = buffer.readUInt16LE(format.offset + 2);
  const sampleRate = buffer.readUInt32LE(format.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(format.offset + 14);
  if (encoding !== 1 || bitsPerSample !== 16 || channels < 1) {
    throw new Error('Input WAV must use PCM 16-bit audio');
  }

  const frameCount = Math.floor(data.size / 2 / channels);
  const mono = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += buffer.readInt16LE(data.offset + (frame * channels + channel) * 2);
    }
    mono[frame] = Math.round(sum / channels);
  }
  const samples = resampleLinear(mono, sampleRate, SAMPLE_RATE);
  const markerLength = Math.min(Math.round(0.12 * SAMPLE_RATE), samples.length);
  let markerStart = 0;
  let markerEnergy = -1;
  const markerStep = Math.max(1, Math.round(0.02 * SAMPLE_RATE));
  for (let offset = 0; offset + markerLength <= samples.length; offset += markerStep) {
    let energy = 0;
    for (let index = offset; index < offset + markerLength; index += 8) {
      energy += samples[index] * samples[index];
    }
    if (energy > markerEnergy) {
      markerEnergy = energy;
      markerStart = offset;
    }
  }
  return { samples, sampleRate: SAMPLE_RATE, markerStart, markerLength };
}

function encodePcmWav(samples, sampleRate = SAMPLE_RATE) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }
  return buffer;
}

function concatenate(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Int16Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function cloneAudioFrame(frame) {
  const samples = new Int16Array(frame.samples.length);
  samples.set(frame.samples);
  return {
    samples,
    sampleRate: frame.sampleRate,
    bitsPerSample: frame.bitsPerSample,
    channelCount: frame.channelCount,
    numberOfFrames: frame.numberOfFrames ?? Math.floor(samples.length / frame.channelCount),
  };
}

function createFrameImpairer(source, impairment, seed) {
  const random = seededRandom(seed);
  const timers = new Set();
  let receivedFrames = 0;
  let echoedFrames = 0;
  let droppedFrames = 0;
  let closed = false;

  const send = (frame) => {
    if (closed) return;
    source.onData(frame);
    echoedFrames += 1;
  };

  return {
    push(frame) {
      if (closed) return;
      receivedFrames += 1;
      if (random() * 100 < impairment.lossPercent) {
        droppedFrames += 1;
        return;
      }
      const ownedFrame = cloneAudioFrame(frame);
      const jitter = impairment.jitterMs ? (random() * 2 - 1) * impairment.jitterMs : 0;
      const delay = Math.max(0, impairment.delayMs + jitter);
      if (delay < 1) {
        send(ownedFrame);
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        send(ownedFrame);
      }, delay);
      timers.add(timer);
    },
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    metrics() {
      return { receivedFrames, echoedFrames, droppedFrames };
    },
  };
}

async function availablePort() {
  const server = createProbeServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error('Could not allocate a benchmark port');
  return port;
}

function waitFor(check, timeoutMs, label) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const poll = () => {
      try {
        const value = check();
        if (value) {
          resolvePromise(value);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function sleepUntil(deadline) {
  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(0, remaining - 1)));
  }
}

async function pumpAudio(source, samples) {
  const startedAt = performance.now();
  let frames = 0;
  for (let offset = 0; offset < samples.length; offset += FRAME_SAMPLES) {
    const frameSamples = new Int16Array(FRAME_SAMPLES);
    frameSamples.set(samples.subarray(offset, Math.min(samples.length, offset + FRAME_SAMPLES)));
    source.onData({
      samples: frameSamples,
      sampleRate: SAMPLE_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: FRAME_SAMPLES,
    });
    frames += 1;
    await sleepUntil(startedAt + frames * FRAME_MS);
  }
  return startedAt;
}

function waitForDataChannel(session) {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for the control data channel')), 15_000);
    const accept = (label, channel) => {
      if (label !== 'control') return;
      const finish = () => {
        clearTimeout(timeout);
        resolvePromise(channel);
      };
      if (channel.readyState === 'open') finish();
      else channel.addEventListener('open', finish, { once: true });
    };
    session.onDataChannel(accept);
  });
}

async function measureDataChannelRtt(channel, count = 10) {
  const pending = new Map();
  const listener = (event) => {
    try {
      const message = JSON.parse(String(event.data));
      pending.get(message.id)?.(performance.now());
    } catch {
      // Ignore unrelated benchmark messages.
    }
  };
  channel.addEventListener('message', listener);
  const samples = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const id = `ping-${index}`;
      const sentAt = performance.now();
      const receivedAt = await new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Data-channel ping timed out'));
        }, 3_000);
        pending.set(id, (value) => {
          clearTimeout(timeout);
          pending.delete(id);
          resolvePromise(value);
        });
        channel.send(JSON.stringify({ id }));
      });
      samples.push(receivedAt - sentAt);
    }
  } finally {
    channel.removeEventListener('message', listener);
  }
  return samples;
}

function correlationAt(reference, received, receivedStart, stride = 8) {
  let dot = 0;
  let referenceEnergy = 0;
  let receivedEnergy = 0;
  for (let index = 0; index < reference.length; index += stride) {
    const receivedIndex = receivedStart + index;
    if (receivedIndex < 0 || receivedIndex >= received.length) continue;
    const left = reference[index];
    const right = received[receivedIndex];
    dot += left * right;
    referenceEnergy += left * left;
    receivedEnergy += right * right;
  }
  if (!referenceEnergy || !receivedEnergy) return -1;
  return dot / Math.sqrt(referenceEnergy * receivedEnergy);
}

function findMarker(audio, reference) {
  const marker = reference.samples.subarray(
    reference.markerStart,
    reference.markerStart + reference.markerLength,
  );
  if (marker.length < 100) throw new Error('Reference audio is too short for its synchronization marker');
  let bestIndex = -1;
  let bestScore = -1;
  const coarseStep = 24;
  for (let index = 0; index <= audio.length - marker.length; index += coarseStep) {
    const score = correlationAt(marker, audio, index, 12);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const coarseIndex = bestIndex;
  for (
    let index = Math.max(0, coarseIndex - coarseStep);
    index <= Math.min(audio.length - marker.length, coarseIndex + coarseStep);
    index += 1
  ) {
    const score = correlationAt(marker, audio, index, 6);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return { index: bestIndex, score: bestScore };
}

function rms(samples, start = 0, length = samples.length) {
  let sum = 0;
  let count = 0;
  const end = Math.min(samples.length, start + length);
  for (let index = Math.max(0, start); index < end; index += 1) {
    sum += samples[index] * samples[index];
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function analyzeAudio(reference, received, marker) {
  const alignedStart = marker.index - reference.markerStart;
  const correlation = correlationAt(reference.samples, received, alignedStart, 4);
  const receivedRms = rms(received, Math.max(0, alignedStart), reference.samples.length);
  const referenceRms = rms(reference.samples);
  const windowSize = Math.round(0.02 * SAMPLE_RATE);
  let activeWindows = 0;
  let dropoutWindows = 0;
  for (let offset = 0; offset < reference.samples.length; offset += windowSize) {
    const referenceWindowRms = rms(reference.samples, offset, windowSize);
    if (referenceWindowRms < 500) continue;
    activeWindows += 1;
    const receivedWindowRms = rms(received, alignedStart + offset, windowSize);
    if (receivedWindowRms < Math.max(120, referenceWindowRms * 0.08)) dropoutWindows += 1;
  }
  return {
    markerCorrelation: marker.score,
    signalCorrelation: correlation,
    alignedStartSample: alignedStart,
    referenceRms,
    receivedRms,
    rmsRatio: referenceRms ? receivedRms / referenceRms : 0,
    activeWindows,
    dropoutWindows,
    dropoutRatio: activeWindows ? dropoutWindows / activeWindows : 0,
  };
}

function serializeStats(report) {
  const values = [];
  report.forEach((entry) => values.push({ ...entry }));
  return values;
}

function summarizeStats(stats) {
  return stats
    .filter((entry) => (
      (entry.type === 'inbound-rtp' || entry.type === 'outbound-rtp')
      && (entry.kind === 'audio' || entry.mediaType === 'audio')
    ) || (entry.type === 'candidate-pair' && (entry.selected || entry.nominated)))
    .map((entry) => {
      const names = [
        'id', 'type', 'kind', 'mediaType', 'packetsSent', 'packetsReceived',
        'packetsLost', 'bytesSent', 'bytesReceived', 'jitter', 'roundTripTime',
        'currentRoundTripTime', 'jitterBufferDelay', 'jitterBufferEmittedCount',
        'concealedSamples', 'concealmentEvents', 'selected', 'nominated', 'state',
      ];
      return Object.fromEntries(names.filter((name) => entry[name] !== undefined).map((name) => [name, entry[name]]));
    });
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function rounded(value, digits = 2) {
  return value == null || !Number.isFinite(value) ? value : Number(value.toFixed(digits));
}

async function runOnce({ reference, impairment, runNumber }) {
  const { RTCAudioSink, RTCAudioSource } = wrtc.nonstandard;
  const resources = new Map();
  const port = await availablePort();
  const router = new NodeRouter({
    port,
    hostname: '127.0.0.1',
    disableHttpRoutes: true,
    connectionGracePeriodMs: 1_000,
    createLivePeerConnection: (configuration) => new wrtc.RTCPeerConnection(configuration),
  });

  router.onLive('/benchmark/audio', {
    offerTimeoutMs: 15_000,
    negotiationTimeoutMs: 15_000,
    open({ sessionId, peer }) {
      const outputSource = new RTCAudioSource();
      const outputTrack = outputSource.createTrack();
      const outputImpairer = createFrameImpairer(outputSource, impairment, 0x5eed + runNumber);
      const state = {
        peer,
        outputSource,
        outputTrack,
        outputImpairer,
        inputSink: null,
        receivedChunks: [],
        captureStartedAt: null,
      };
      resources.set(sessionId, state);
      peer.addTrack(outputTrack);
      peer.onTrack((event) => {
        if (event.track.kind !== 'audio') return;
        const sink = new RTCAudioSink(event.track);
        state.inputSink = sink;
        sink.ondata = (frame) => {
          if (state.captureStartedAt === null) state.captureStartedAt = performance.now();
          const channelCount = Math.max(1, frame.channelCount || 1);
          const mono = new Int16Array(Math.floor(frame.samples.length / channelCount));
          for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
            let sum = 0;
            for (let channel = 0; channel < channelCount; channel += 1) {
              sum += frame.samples[sampleIndex * channelCount + channel];
            }
            mono[sampleIndex] = Math.round(sum / channelCount);
          }
          state.receivedChunks.push(resampleLinear(mono, frame.sampleRate, SAMPLE_RATE));
        };
      });
      peer.onDataChannel((channel) => {
        if (channel.label !== 'control') return;
        channel.onmessage = (event) => {
          if (channel.readyState === 'open') channel.send(event.data);
        };
      });
    },
    onClose({ sessionId }) {
      const state = resources.get(sessionId);
      resources.delete(sessionId);
      state?.outputImpairer.close();
      state?.inputSink?.stop();
      state?.outputTrack.stop();
    },
  });

  let client;
  let session;
  let inputTrack;
  let outputSink;
  const clientReceivedChunks = [];
  let clientCaptureStartedAt = null;
  const errors = [];
  const benchmarkStartedAt = performance.now();
  try {
    await router.start();
    client = new Client(`http://127.0.0.1:${port}`, 'websocket', {
      reconnect: false,
      timeout: 15_000,
    });
    const connectionStartedAt = performance.now();
    await client.connect();
    const controlConnectedAt = performance.now();

    const inputSource = new RTCAudioSource();
    inputTrack = inputSource.createTrack();
    const localStream = new wrtc.MediaStream([inputTrack]);
    session = await client.live('/benchmark/audio', {
      stream: localStream,
      receive: { audio: true },
      data: { control: { ordered: true } },
      stopLocalTracksOnLeave: false,
      signalingTimeoutMs: 15_000,
      negotiationTimeoutMs: 15_000,
    });
    session.onError((error) => errors.push(error.message));

    let remoteAudioTrack = null;
    session.onRemoteStream((stream) => {
      if (outputSink) return;
      remoteAudioTrack = stream.getAudioTracks()[0] || null;
      if (!remoteAudioTrack) return;
      outputSink = new RTCAudioSink(remoteAudioTrack);
      outputSink.ondata = (frame) => {
        if (clientCaptureStartedAt === null) clientCaptureStartedAt = performance.now();
        const channelCount = Math.max(1, frame.channelCount || 1);
        const mono = new Int16Array(Math.floor(frame.samples.length / channelCount));
        for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
          let sum = 0;
          for (let channel = 0; channel < channelCount; channel += 1) {
            sum += frame.samples[sampleIndex * channelCount + channel];
          }
          mono[sampleIndex] = Math.round(sum / channelCount);
        }
        clientReceivedChunks.push(resampleLinear(mono, frame.sampleRate, SAMPLE_RATE));
      };
    });

    await waitFor(() => session.state === 'connected' || (session.state === 'failed' && (() => {
      throw new Error(`Live session failed: ${errors.join('; ') || 'unknown error'}`);
    })()), 15_000, 'the live peer to connect');
    const mediaConnectedAt = performance.now();
    const channel = await waitForDataChannel(session);
    await waitFor(() => outputSink, 5_000, 'the returned audio track');
    const serverState = await waitFor(
      () => [...resources.values()][0]?.inputSink && [...resources.values()][0],
      5_000,
      'the server audio sink',
    );
    const pingRtts = await measureDataChannelRtt(channel);

    // The native source may be attached before its RTP sender is fully running.
    // Pace silence through both sources first so the synchronization marker is
    // never among the frames discarded while the sender warms up.
    const warmupSamples = new Int16Array(SAMPLE_RATE * SOURCE_WARMUP_MS / 1_000);
    await Promise.all([
      pumpAudio(inputSource, warmupSamples),
      pumpAudio(serverState.outputSource, warmupSamples),
    ]);

    const clientOutputImpairer = createFrameImpairer(inputSource, impairment, 0xcafe + runNumber);
    const [clientPumpStartedAt, serverPumpStartedAt] = await Promise.all([
      pumpAudio({ onData: (frame) => clientOutputImpairer.push(frame) }, reference.samples),
      pumpAudio({ onData: (frame) => serverState.outputImpairer.push(frame) }, reference.samples),
    ]);
    const tailWaitMs = Math.max(1_000, impairment.delayMs + impairment.jitterMs + 700);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, tailWaitMs));
    clientOutputImpairer.close();

    const [clientReport, serverReport] = await Promise.all([
      session.getStats(),
      serverState.peer.getStats(),
    ]);
    const clientStats = serializeStats(clientReport);
    const serverStats = serializeStats(serverReport);
    const clientReceived = concatenate(clientReceivedChunks);
    const serverReceived = concatenate(serverState.receivedChunks);
    if (clientReceived.length < reference.samples.length / 3) {
      throw new Error(`Client received too little audio: ${clientReceived.length} samples`);
    }
    if (serverReceived.length < reference.samples.length / 3) {
      throw new Error(`Server received too little audio: ${serverReceived.length} samples`);
    }
    const clientMarker = findMarker(clientReceived, reference);
    const serverMarker = findMarker(serverReceived, reference);
    if (clientMarker.index < 0 || clientMarker.score < 0.12) {
      throw new Error(`Could not find the client synchronization marker (score ${clientMarker.score.toFixed(3)})`);
    }
    if (serverMarker.index < 0 || serverMarker.score < 0.12) {
      throw new Error(`Could not find the server synchronization marker (score ${serverMarker.score.toFixed(3)})`);
    }
    const serverToClient = analyzeAudio(reference, clientReceived, clientMarker);
    const clientToServer = analyzeAudio(reference, serverReceived, serverMarker);
    const serverToClientLatencyMs = clientCaptureStartedAt === null
      ? null
      : clientCaptureStartedAt + clientMarker.index / SAMPLE_RATE * 1_000
        - (serverPumpStartedAt + reference.markerStart / SAMPLE_RATE * 1_000);
    const clientToServerLatencyMs = serverState.captureStartedAt === null
      ? null
      : serverState.captureStartedAt + serverMarker.index / SAMPLE_RATE * 1_000
        - (clientPumpStartedAt + reference.markerStart / SAMPLE_RATE * 1_000);

    return {
      clientReceived,
      serverReceived,
      result: {
        run: runNumber,
        timings: {
          controlConnectMs: rounded(controlConnectedAt - connectionStartedAt),
          liveSetupMs: rounded(mediaConnectedAt - controlConnectedAt),
          totalSetupMs: rounded(mediaConnectedAt - connectionStartedAt),
          serverToClientLatencyMs: rounded(serverToClientLatencyMs),
          clientToServerLatencyMs: rounded(clientToServerLatencyMs),
          dataChannelRttP50Ms: rounded(percentile(pingRtts, 0.5)),
          dataChannelRttP95Ms: rounded(percentile(pingRtts, 0.95)),
          totalRunMs: rounded(performance.now() - benchmarkStartedAt),
        },
        audio: {
          serverToClient: Object.fromEntries(Object.entries(serverToClient).map(([key, value]) => [key, rounded(value, 4)])),
          clientToServer: Object.fromEntries(Object.entries(clientToServer).map(([key, value]) => [key, rounded(value, 4)])),
        },
        mediaInjection: {
          serverToClient: serverState.outputImpairer.metrics(),
          clientToServer: clientOutputImpairer.metrics(),
        },
        errors,
        stats: {
          client: summarizeStats(clientStats),
          server: summarizeStats(serverStats),
        },
        rawStats: { client: clientStats, server: serverStats },
      },
    };
  } finally {
    outputSink?.stop();
    inputTrack?.stop();
    if (session) await session.leave().catch(() => {});
    client?.close();
    await router.close().catch(() => {});
    // Native WebRTC workers release their final references asynchronously.
    // A short drain prevents process teardown from racing those destructors.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}

function aggregate(results) {
  const timingNames = [
    'controlConnectMs', 'liveSetupMs', 'totalSetupMs', 'serverToClientLatencyMs',
    'clientToServerLatencyMs',
    'dataChannelRttP50Ms', 'dataChannelRttP95Ms',
  ];
  const timings = {};
  for (const name of timingNames) {
    const values = results.map((result) => result.timings[name]).filter(Number.isFinite);
    timings[name] = {
      p50: rounded(percentile(values, 0.5)),
      p95: rounded(percentile(values, 0.95)),
      min: rounded(values.length ? Math.min(...values) : null),
      max: rounded(values.length ? Math.max(...values) : null),
    };
  }
  const audio = {};
  for (const direction of ['serverToClient', 'clientToServer']) {
    audio[direction] = {};
    for (const name of ['markerCorrelation', 'signalCorrelation', 'rmsRatio', 'dropoutRatio']) {
      const values = results.map((result) => result.audio[direction][name]).filter(Number.isFinite);
      audio[direction][name] = {
        p50: rounded(percentile(values, 0.5), 4),
        min: rounded(values.length ? Math.min(...values) : null, 4),
        max: rounded(values.length ? Math.max(...values) : null, 4),
      };
    }
  }
  return { timings, audio };
}

function printResult(result) {
  const timing = result.timings;
  const down = result.audio.serverToClient;
  const up = result.audio.clientToServer;
  console.log(`Run ${result.run}: setup=${timing.totalSetupMs}ms down=${timing.serverToClientLatencyMs}ms up=${timing.clientToServerLatencyMs}ms data-rtt-p50=${timing.dataChannelRttP50Ms}ms`);
  console.log(`       down correlation=${down.signalCorrelation} dropouts=${rounded(down.dropoutRatio * 100)}%; up correlation=${up.signalCorrelation} dropouts=${rounded(up.dropoutRatio * 100)}%`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  installWebRtcGlobals();
  const reference = options.input
    ? await readPcmWav(options.input)
    : createGeneratedAudio(options.durationSeconds);
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputDirectory = options.output || join(scriptDirectory, 'artifacts', 'live-audio', `${stamp}-${options.profileName}`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'reference.wav'), encodePcmWav(reference.samples));

  console.log(`Profile: ${options.profileName} (${JSON.stringify(options.impairment)})`);
  if (process.env.NETWORK_PROFILE) console.log(`Network container profile: ${process.env.NETWORK_PROFILE}`);
  console.log(`Audio: ${(reference.samples.length / SAMPLE_RATE).toFixed(2)}s, runs: ${options.runs}`);

  const results = [];
  for (let run = 1; run <= options.runs; run += 1) {
    const { result, clientReceived, serverReceived } = await runOnce({
      reference,
      impairment: options.impairment,
      runNumber: run,
    });
    results.push(result);
    await writeFile(join(outputDirectory, `received-client-${run}.wav`), encodePcmWav(clientReceived));
    await writeFile(join(outputDirectory, `received-server-${run}.wav`), encodePcmWav(serverReceived));
    await writeFile(join(outputDirectory, `run-${run}.json`), `${JSON.stringify(result, null, 2)}\n`);
    printResult(result);
  }

  const summary = {
    createdAt: new Date().toISOString(),
    runtime: { platform: process.platform, arch: process.arch, node: process.version },
    networkProfile: process.env.NETWORK_PROFILE || null,
    mediaProfile: options.profileName,
    impairment: options.impairment,
    input: options.input,
    durationSeconds: reference.samples.length / SAMPLE_RATE,
    runs: results.length,
    aggregate: aggregate(results),
    results: results.map(({ rawStats, ...result }) => result),
  };
  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Artifacts: ${outputDirectory}`);

  // @roamhq/wrtc can race native audio worker destructors during Node process
  // teardown even after every sink, track, and peer has been closed. This is a
  // dedicated one-shot benchmark process and all artifacts are flushed above,
  // so exit directly after a successful run.
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
