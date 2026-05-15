/**
 * Weather Signals — OpenWeatherMap 7-day Forecast
 * Free tier: 1000 calls/day, more than enough for manual triggers.
 */

// ============================================
// TYPES
// ============================================

export interface DayForecast {
    date: string          // "2026-05-22"
    temp: number          // 28
    tempMin: number       // 18
    tempMax: number       // 30
    description: string   // "clear sky"
    descriptionCz: string // "jasno"
    icon: string          // "01d"
    humidity: number      // 45
    windSpeed: number     // 3.2
    rain: number          // mm of rain (0 = no rain)
    clouds: number        // % cloud cover
}

export interface WeekForecast {
    city: string
    country: string
    days: DayForecast[]
}

// ============================================
// WEATHER DESCRIPTION TRANSLATION
// ============================================

const WEATHER_CZ: Record<string, string> = {
    "clear sky": "jasno",
    "few clouds": "polojasno",
    "scattered clouds": "polojasno",
    "broken clouds": "oblačno",
    "overcast clouds": "zataženo",
    "light rain": "lehký déšť",
    "moderate rain": "déšť",
    "heavy intensity rain": "silný déšť",
    "very heavy rain": "přívalový déšť",
    "shower rain": "přeháňky",
    "light intensity shower rain": "lehké přeháňky",
    "thunderstorm": "bouřka",
    "thunderstorm with light rain": "bouřka s deštěm",
    "snow": "sníh",
    "light snow": "sněžení",
    "mist": "mlha",
    "fog": "hustá mlha",
    "haze": "opar",
    "drizzle": "mrholení",
    "light intensity drizzle": "lehké mrholení",
}

function translateWeather(desc: string): string {
    return WEATHER_CZ[desc.toLowerCase()] || desc
}

// ============================================
// API
// ============================================

const OWM_API_KEY = process.env.OPENWEATHER_API_KEY || ""

/**
 * Get 7-day weather forecast for a city.
 * Uses OpenWeatherMap One Call API 3.0 or free forecast endpoint.
 */
export async function getWeatherForecast(city: string = "Praha"): Promise<WeekForecast | null> {
    if (!OWM_API_KEY) {
        console.warn("⚠️ OPENWEATHER_API_KEY not set — skipping weather")
        return null
    }

    try {
        // Step 1: Geocode city name to lat/lon
        const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)},CZ&limit=1&appid=${OWM_API_KEY}`
        const geoRes = await fetch(geoUrl)
        const geoData = await geoRes.json()

        if (!geoData || geoData.length === 0) {
            console.warn(`⚠️ City "${city}" not found`)
            return null
        }

        const { lat, lon, name, country } = geoData[0]

        // Step 2: Get 7-day forecast (free tier: 5-day/3-hour, but we aggregate to daily)
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=cz&appid=${OWM_API_KEY}`
        const forecastRes = await fetch(forecastUrl)
        const forecastData = await forecastRes.json()

        if (!forecastData.list) {
            console.warn("⚠️ No forecast data returned")
            return null
        }

        // Aggregate 3-hour intervals into daily forecasts
        const dailyMap = new Map<string, { temps: number[]; descriptions: string[]; rain: number; humidity: number[]; wind: number[]; clouds: number[]; icons: string[] }>()

        for (const item of forecastData.list) {
            const date = item.dt_txt.split(" ")[0]
            if (!dailyMap.has(date)) {
                dailyMap.set(date, { temps: [], descriptions: [], rain: 0, humidity: [], wind: [], clouds: [], icons: [] })
            }
            const d = dailyMap.get(date)!
            d.temps.push(item.main.temp)
            d.descriptions.push(item.weather[0].description)
            d.rain += (item.rain?.["3h"] || 0)
            d.humidity.push(item.main.humidity)
            d.wind.push(item.wind.speed)
            d.clouds.push(item.clouds.all)
            d.icons.push(item.weather[0].icon)
        }

        const days: DayForecast[] = []
        for (const [date, data] of dailyMap) {
            if (days.length >= 7) break

            // Pick most common description (daytime preference)
            const daytimeDescs = data.descriptions.slice(0, Math.ceil(data.descriptions.length * 0.7))
            const descCount = new Map<string, number>()
            for (const d of daytimeDescs) {
                descCount.set(d, (descCount.get(d) || 0) + 1)
            }
            const mainDesc = [...descCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || data.descriptions[0]

            const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length

            days.push({
                date,
                temp: Math.round(avg(data.temps)),
                tempMin: Math.round(Math.min(...data.temps)),
                tempMax: Math.round(Math.max(...data.temps)),
                description: mainDesc,
                descriptionCz: translateWeather(mainDesc),
                icon: data.icons[Math.floor(data.icons.length / 3)] || data.icons[0], // pick midday icon
                humidity: Math.round(avg(data.humidity)),
                windSpeed: Math.round(avg(data.wind) * 10) / 10,
                rain: Math.round(data.rain * 10) / 10,
                clouds: Math.round(avg(data.clouds)),
            })
        }

        return { city: name, country, days }
    } catch (err: any) {
        console.error("⚠️ Weather API error:", err?.message)
        return null
    }
}

/**
 * Format forecast as human-readable text for AI prompts.
 */
export function formatForecastForAI(forecast: WeekForecast): string {
    const lines = forecast.days.map(d => {
        const date = new Date(d.date)
        const dayName = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"][date.getDay()]
        const dateStr = `${date.getDate()}.${date.getMonth() + 1}.`
        const rain = d.rain > 0 ? `, déšť ${d.rain}mm` : ""
        return `${dayName} ${dateStr}: ${d.tempMin}–${d.tempMax}°C, ${d.descriptionCz}${rain}`
    })

    return `Počasí v ${forecast.city} (${forecast.days.length} dní):\n${lines.join("\n")}`
}
