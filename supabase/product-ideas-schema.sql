-- Create the ig_product_ideas table
CREATE TABLE IF NOT EXISTS public.ig_product_ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tagline TEXT,
    description TEXT,
    material TEXT,
    dimensions TEXT,
    manufacturing_method TEXT,
    price_range TEXT,
    viral_angle TEXT,
    why_it_works TEXT,
    production_notes TEXT,
    design_prompt TEXT,
    status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'saved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.ig_product_ideas ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for all users" ON public.ig_product_ideas FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON public.ig_product_ideas FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users only" ON public.ig_product_ideas FOR UPDATE USING (true);
CREATE POLICY "Enable delete for authenticated users only" ON public.ig_product_ideas FOR DELETE USING (true);
