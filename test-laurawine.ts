import { analyzeWebsite } from './app/onboarding/actions'

async function run() {
    console.time("analyzeWebsite")
    const res = await analyzeWebsite("Laurawine.cz", "")
    console.timeEnd("analyzeWebsite")
    console.log(JSON.stringify(res, null, 2))
}

run()
