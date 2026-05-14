-- Dynamic Product Categories — per-client product types with AI instructions
-- Run in Supabase SQL Editor

-- 1. Create the table
CREATE TABLE ig_product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE, -- NULL = global default
  slug text NOT NULL,
  label text NOT NULL,
  icon text DEFAULT '📦',

  -- AI instructions for visualization
  design_guide text NOT NULL,       -- How Art Director should render this product type
  mockup_prompt text,               -- Base prompt for blank product mockup generation
  material_hint text,               -- Material context for AI
  manufacturing_hint text,          -- Manufacturing method context for AI

  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Unique constraint: one slug per client (or per global)
CREATE UNIQUE INDEX idx_product_categories_unique
  ON ig_product_categories (COALESCE(client_id, '00000000-0000-0000-0000-000000000000'), slug);

-- 3. Index for fast lookups
CREATE INDEX idx_product_categories_client
  ON ig_product_categories (client_id, is_active, sort_order);

-- 4. RLS
ALTER TABLE ig_product_categories ENABLE ROW LEVEL SECURITY;

-- 5. Seed: global defaults (client_id = NULL)
INSERT INTO ig_product_categories (client_id, slug, label, icon, design_guide, mockup_prompt, material_hint, manufacturing_hint, sort_order) VALUES
(NULL, 'triko', 'Triko', '👕',
  'Design pro potisk trička — ZOBRAZ CELÉ TRIČKO (laid flat nebo na modelovi) s tvým designem. Kvalitní produktová fotka, ne jen izolovaná grafika.',
  'blank plain black t-shirt laid flat on simple studio background, high quality apparel product photography, no text, no logo, pristine condition',
  'bavlna 240gsm', 'DTG potisk, sítotisk', 1),

(NULL, 'mikina', 'Mikina', '🧥',
  'Design pro potisk mikiny — ZOBRAZ CELOU MIKINU s tvým designem. Streetwear produktová fotka na tmavém pozadí.',
  'blank plain black hoodie sweatshirt laid flat on simple studio background, high quality apparel product photography, no text, no logo, pristine condition',
  'froté bavlna', 'DTG potisk, vyšívání', 2),

(NULL, 'cepice', 'Čepice', '🧢',
  'Design/vizualizace kšiltovky s tvým designem. Zobraz celý produkt (snapback), detailní materiály, výšivka/potisk loga.',
  'blank plain black snapback cap, front view, isolated on dark studio background, product photography, no text, no logo',
  'bavlna, polyester', 'vyšívání, potisk', 3),

(NULL, 'ponozky', 'Ponožky', '🧦',
  'Design pro ponožky — pár ponožek s vtipným celoplošným potiskem. Zobraz celý produkt v realistickém provedení.',
  'pair of blank plain black crew socks laid flat, high quality apparel product photography, studio lighting, no text, no logo',
  'bavlna, elastan', 'sublimační tisk', 4),

(NULL, 'taska', 'Taška', '👜',
  'Design pro plátěnou tašku (tote bag). Zobraz celou tašku s výrazným potiskem na tmavém pozadí.',
  'blank plain black canvas tote bag shopper, isolated on dark studio background, product photography, no text, no logo',
  'plátno, bavlna', 'sítotisk, DTG', 5),

(NULL, 'plakat', 'Plakát', '🖼️',
  'Design pro plakát — zobraz plakát v minimalistickém rámu v interiéru nebo na zdi. Umělecké dílo.',
  'vertical blank white poster mockup in a minimal modern black frame leaning against a dark wall, studio lighting, high resolution',
  'matný papír 200gsm', 'digitální tisk', 6),

(NULL, 'polstar', 'Polštář', '🛋️',
  'Design pro polštář — zobraz polštář s tvým vzorem/grafikou v interiéru.',
  'blank plain white square throw pillow, isolated on a dark minimal sofa background, product photography, no text, no logo',
  'polyester, bavlna', 'sublimační tisk', 7),

(NULL, 'hrnek', 'Hrnek', '☕',
  'Design pro hrnek — zobraz celý hrnek s fotorealistickým potiskem na tmavém pozadí.',
  'blank plain white ceramic coffee mug, studio lighting, isolated on dark background, product photography, no text, no logo',
  'keramika', 'sublimační tisk', 8),

(NULL, 'gadget', 'Gadget', '🔧',
  'Design/vizualizace fyzického gadgetu — produkt samotný. ZOBRAZ CELÝ PRODUKT: tvar, materiál, logo placement.',
  'blank product gadget on dark studio background, product photography, no text, no logo',
  'ABS plast, kov', 'injection mold, laser', 9),

(NULL, 'accessory', 'Doplněk', '🔑',
  'Design/vizualizace doplňku — produkt samotný. ZOBRAZ CELÝ PRODUKT: materiál, gravírování/potisk loga.',
  'blank accessory item on dark studio background, product photography, no text, no logo',
  'kov, kůže, silikon', 'gravírování, laser', 10),

(NULL, 'card', 'Karta', '💳',
  'Design vizitko-velikosti produktu — zobraz materiál, gravírování, texturu.',
  'blank metal business card on dark studio background, product photography, no text',
  'nerez ocel, hliník', 'laser gravírování', 11);
