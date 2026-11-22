import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommentaryDuckingFilterGraph,
  buildVerticalShortsFilterGraph,
  isSafeYouTubeUrl,
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

test('buildVerticalShortsFilterGraph produces non-AI 1080x1920 blurred-background overlay filter', () => {
  const graph = buildVerticalShortsFilterGraph();
  assert.ok(graph.includes('scale=1080:1920:force_original_aspect_ratio=increase'));
  assert.ok(graph.includes('boxblur='));
  assert.ok(graph.includes('scale=1080:1920:force_original_aspect_ratio=decrease'));
  assert.ok(graph.includes('overlay=(W-w)/2:(H-h)/2'));
});

test('buildCommentaryDuckingFilterGraph ducks stadium audio under loudnorm voiceover', () => {
  const graph = buildCommentaryDuckingFilterGraph(0.22);
  assert.ok(graph.includes('[0:a]volume=0.22[crowd]'));
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
