import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBroadcastMixFilterGraph,
  buildCameraPanExpression,
  buildCommentaryDuckingFilterGraph,
  buildCrowdAudioMixFilterGraph,
  buildLandscapeRotationFilter,
  buildVerticalShortsFilterGraph,
  generateFootballShortMetadata,
  isSafeYouTubeUrl,
  normalizeCameraTrack,
  normalizeCommentaryCues,
  normalizeShortsDescription,
  normalizeShortsTitle,
} from './commentary-sync.js';

test('normalizeShortsTitle appends #Shorts and enforces 100-char YouTube limit', () => {
  assert.equal(normalizeShortsTitle('Incredible 30-Yard Volley!'), 'Incredible 30-Yard Volley! #Shorts');
  assert.equal(normalizeShortsTitle('Top Bins Curler #shorts'), 'Top Bins Curler #shorts');

  const longTitle = 'A'.repeat(120);
  const normalized = normalizeShortsTitle(longTitle);
  assert.ok(normalized.length <= 100);
  assert.ok(normalized.endsWith('#Shorts'));
});

test('normalizeShortsDescription appends missing football Shorts hashtags without duplication', () => {
  const result = normalizeShortsDescription('Thunderous strike into the top corner.', ['PremierGoal', 'Volley']);
  assert.ok(result.includes('#Shorts'));
  assert.ok(result.includes('#Football'));
  assert.ok(result.includes('#PremierGoal'));
  assert.ok(result.includes('#Volley'));
});

test('normalizeCommentaryCues enforces monotonic non-overlapping cues within 6.0s clip window', () => {
  const messyCues = [
    {
      beat: 'strike' as const,
      startSec: 2.5,
      endSec: 4.5,
      text: 'He connects cleanly on the half volley from twenty five yards out with blistering pace right past the keeper',
      energy: 'peak' as const,
    },
    {
      beat: 'buildup' as const,
      startSec: -0.5,
      endSec: 2.8,
      text: 'Quick touch outside the box!',
      energy: 'rising' as const,
    },
    {
      beat: 'celebration' as const,
      startSec: 5.0,
      endSec: 8.5,
      text: 'The stadium erupts!',
      energy: 'afterglow' as const,
    },
  ];

  const normalized = normalizeCommentaryCues(messyCues, 6.0);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].beat, 'buildup');
  assert.ok(normalized[0].startSec >= 0);

  for (let i = 0; i < normalized.length; i++) {
    assert.ok(normalized[i].endSec > normalized[i].startSec, 'cue must have positive duration');
    assert.ok(normalized[i].endSec <= 6.0, 'cue must not exceed clip length');
    if (i > 0) {
      assert.ok(
        normalized[i].startSec >= normalized[i - 1].endSec,
        'cues must be strictly non-overlapping'
      );
    }
  }
});

test('normalizeCameraTrack sorts, clamps centerX to [0, 1], and deduplicates keyframes', () => {
  const track = normalizeCameraTrack(
    [
      { timeSec: 4.7, centerX: 0.2 },
      { timeSec: 0, centerX: 1.2 },
      { timeSec: 2.5, centerX: 0.55 },
      { timeSec: 5.9, centerX: -0.1 },
    ],
    6.0
  );
  assert.equal(track.length, 4);
  assert.equal(track[0].timeSec, 0);
  assert.equal(track[0].centerX, 1);
  assert.equal(track[1].timeSec, 2.5);
  assert.equal(track[3].centerX, 0);
});

test('buildVerticalShortsFilterGraph produces full-screen 1080x1920 dynamic pan-and-scan crop without blur bars', () => {
  const centeredGraph = buildVerticalShortsFilterGraph();
  assert.ok(centeredGraph.includes("crop=w='min(iw,ih*9/16)':h='ih':x='(iw-ow)/2':y=0"));
  assert.ok(centeredGraph.includes('scale=1080:1920:flags=lanczos'));
  assert.ok(!centeredGraph.includes('boxblur'));

  const trackedGraph = buildVerticalShortsFilterGraph([
    { timeSec: 0.0, centerX: 0.75 },
    { timeSec: 2.5, centerX: 0.55 },
    { timeSec: 4.0, centerX: 0.3 },
    { timeSec: 5.9, centerX: 0.2 },
  ]);
  assert.ok(trackedGraph.includes("crop=w='min(iw,ih*9/16)':h='ih':x='clip(("));
  assert.ok(trackedGraph.includes('*iw-ow/2,0,iw-ow)'));
  assert.ok(trackedGraph.includes('if(lt(t,2.5)'));
  assert.ok(trackedGraph.includes('scale=1080:1920:flags=lanczos'));

  assert.equal(buildCameraPanExpression([]), '(iw-ow)/2');
});

test('buildCommentaryDuckingFilterGraph ducks stadium audio under loudnorm voiceover', () => {
  const graph = buildCommentaryDuckingFilterGraph(0.25);
  assert.ok(graph.includes('[0:a]volume=0.25[crowd]'));
  assert.ok(graph.includes('sidechaincompress'));
  assert.ok(graph.includes('loudnorm'));
  assert.ok(graph.includes('amix=inputs=2'));
});

test('isSafeYouTubeUrl allows only https YouTube origins and blocks javascript URLs', () => {
  assert.equal(isSafeYouTubeUrl('https://www.youtube.com/shorts/abc123XYZ'), true);
  assert.equal(isSafeYouTubeUrl('https://youtube.com/shorts/abc123XYZ'), true);
  assert.equal(isSafeYouTubeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeYouTubeUrl('http://evil.example.com/shorts/abc'), false);
  assert.equal(isSafeYouTubeUrl(null), false);
});

test('buildLandscapeRotationFilter rotates landscape videos 90 deg clockwise and preserves vertical clips', () => {
  const landscape = buildLandscapeRotationFilter(true);
  assert.ok(landscape.includes('transpose=1'));
  assert.ok(landscape.includes('setsar=1'));

  const vertical = buildLandscapeRotationFilter(false);
  assert.ok(!vertical.includes('transpose=1'));
  assert.ok(vertical.includes('setsar=1'));
});

test('buildCrowdAudioMixFilterGraph stitches normal crowd 0.0-5.15s with delayed burst roar', () => {
  const graph = buildCrowdAudioMixFilterGraph(5.15, 6.0);
  assert.ok(graph.includes('atrim=0:5.4'));
  assert.ok(graph.includes('afade=t=out:st=5:d=0.35:curve=qsin'));
  assert.ok(graph.includes('adelay=5050|5050'));
  assert.ok(graph.includes('atrim=0:6'));
  assert.ok(graph.includes('loudnorm=I=-14'));
});

test('buildBroadcastMixFilterGraph layers intro commentary, pause swell, burst, and goal shout', () => {
  const graph = buildBroadcastMixFilterGraph({
    hasIntroVoice: true,
    hasGoalShout: true,
    totalDurationSec: 6.0,
    riseStartSec: 3.5,
    burstStartSec: 5.15,
    shoutStartSec: 5.03,
    shoutTempo: 1.05,
  });
  assert.ok(graph.includes('[intro]'));
  assert.ok(graph.includes('[shout]'));
  assert.ok(graph.includes('adelay=5030|5030'));
  assert.ok(graph.includes('amix=inputs=4'));
});

test('generateFootballShortMetadata produces #Shorts title, description, and stadium tags without API calls', () => {
  const meta = generateFootballShortMetadata('goal_clip_01.mp4');
  assert.ok(meta.shortsTitle.includes('#Shorts'));
  assert.ok(meta.shortsTitle.length <= 100);
  assert.ok(meta.shortsDescription.includes('#Shorts'));
  assert.ok(meta.tags.includes('Football'));
});
