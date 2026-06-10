import { buildSmartWeekPlan } from "../instagram/caption-generator";

const mockConfig = {
    id: "test",
    name: "Test",
    website: "test.com",
    instagram: "test",
    brandVoice: { persona: "", voiceTraits: [], antiPatterns: [], hookTemplates: [], ctaVariations: [], toneByPostType: {} },
    contentPillars: {},
    weekPlan: ["post"],
    ctaStrategies: {},
} as any;

const mockPerformance = {
    avgEngagement: 10,
    topPatterns: [],
    bestHooks: [],
    pillarPerformance: {}
} as any;

const seq = buildSmartWeekPlan(mockConfig, mockPerformance, 3);
console.log("Length:", seq.length);
console.log("Sequence:", seq);
