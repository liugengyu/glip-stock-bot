const dotenv = require('dotenv')
const commander = require('commander')
const express = require('express')
const RingCentral = require('ringcentral-js-concise')
const fs = require('fs')
const path = require('path')
const bodyParser = require('body-parser')
const axios = require('axios')
const R = require('ramda')
const moment = require('moment')
const cheerio = require('cheerio')

const pkg = require('./package.json')

dotenv.config()
const tokenFile = path.join(__dirname, '.token')
const rc = new RingCentral(
  process.env.GLIP_CLIENT_ID,
  process.env.GLIP_CLIENT_SECRET,
  process.env.GLIP_API_SERVER
)
if (fs.existsSync(tokenFile)) { // restore token
  rc.token(JSON.parse(fs.readFileSync(tokenFile, 'utf-8')))
}

const sendGlipMessage = async (groupId, text, attachments) => {
  try {
    await rc.post('/restapi/v1.0/glip/posts', { groupId, text, attachments })
  } catch (e) {
    console.error(e.response.data)
  }
}

const sendStockMessage = async (symbol, groupId) => {
  let text = null
  let attachments = null
  try {
    const r = await axios.get(`https://www.quandl.com/api/v3/datasets/WIKI/${symbol}.json?api_key=hWMcYrZQW1uL-G5C6Grn&start_date=${moment().subtract(30, 'days').format('YYYY-MM-DD')}`)
    const dataset = r.data.dataset
    const price = dataset.data[0][4]
    const entries = R.slice(0, 6, dataset.data)
    text = `${dataset.name.split(' Prices, ')[0]} **$${price}**`
    attachments = [{
      type: 'Card',
      fallback: text,
      color: '#006400',
      fields: R.map(entry => ({
        title: entry[0],
        value: '$' + entry[4],
        style: 'Short'
      }), entries)
    }]
  } catch (e) {
    await sendGlipMessage(groupId, `**${symbol}** is not a known stock symbol`)
    return
  }
  await sendGlipMessage(groupId, text, attachments)

  text = ''
  attachments = []
  try {
    const r = await axios.get(`http://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&lang=en-US`)
    const $ = cheerio.load(r.data)
    $('item').each(function (i, elem) {
      if (i >= 3) { return false }
      const title = $(this).find('title').text()
      const description = $(this).find('description').text()
      const guid = $(this).find('guid').text()
      attachments.push({
        type: 'Card',
        fallback: `[${title}](http://finance.yahoo.com/r/${guid})`,
        text: description,
        author: {
          name: title,
          uri: `http://finance.yahoo.com/r/${guid}`
        }
      })
    })
  } catch (e) {
    return
  }
  await sendGlipMessage(groupId, `News about **${symbol}**`, attachments)
}

const app = express()
app.use(bodyParser.json())
app.get('/oauth', async (req, res) => {
  try {
    await rc.authorize({ code: req.query.code, redirect_uri: `${process.env.GLIP_BOT_SERVER}/oauth` })
  } catch (e) {
    console.error(e.response.data)
  }
  fs.writeFileSync(tokenFile, JSON.stringify(rc.token())) // save token
  res.send('')
})
app.post('/webhook', async (req, res) => {
  const message = req.body.body
  if (message && message.type === 'TextMessage') {
    if (message.text.startsWith('stock ')) {
      const stockSymbol = message.text.substring(6).trim().toUpperCase()
      await sendStockMessage(stockSymbol, message.groupId)
    }
  }
  res.set('validation-token', req.get('validation-token'))
  res.send('')
})

commander.version(pkg.version).option('-p --port <port>', 'Specify port').parse(process.argv)
app.listen(commander.port || 3000)
