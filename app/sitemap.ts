import { MetadataRoute } from 'next'
import { getAllArticleMeta } from '@/lib/blog'

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = 'https://chrlit.cz'

    const staticRoutes: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 1,
        },
        {
            url: `${baseUrl}/blog`,
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 0.7,
        },
        {
            url: `${baseUrl}/login`,
            lastModified: new Date(),
            changeFrequency: 'monthly',
            priority: 0.5,
        },
        {
            url: `${baseUrl}/register`,
            lastModified: new Date(),
            changeFrequency: 'monthly',
            priority: 0.5,
        },
        {
            url: `${baseUrl}/privacy`,
            lastModified: new Date(),
            changeFrequency: 'yearly',
            priority: 0.3,
        },
        {
            url: `${baseUrl}/terms`,
            lastModified: new Date(),
            changeFrequency: 'yearly',
            priority: 0.3,
        },
    ]

    const articleRoutes: MetadataRoute.Sitemap = getAllArticleMeta().map(a => ({
        url: `${baseUrl}/blog/${a.slug}`,
        lastModified: a.date ? new Date(a.date) : new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
    }))

    return [...staticRoutes, ...articleRoutes]
}
