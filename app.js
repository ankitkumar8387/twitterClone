const express = require('express')
const bcrypt = require('bcrypt')
const sqlite3 = require('sqlite3')
const jwt = require('jsonwebtoken')
const {open} = require('sqlite')

const app = express()
app.use(express.json())

const path = require('path')
const dbpath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}
initializeDBAndServer()

// GETTING ARRAY OF USER FOLLOWING ID'S
const getFollowingPeopleIdsOfUser = async username => {
  const getTheFollowingPeopleQuery = `
    select 
    following_user_id from follower
    inner join user on user.user_id = follower.follower_user_id
    where user.username = '${username}';`
  const followingPeople = await db.all(getTheFollowingPeopleQuery)
  const arrayOfIds = followingPeople.map(eachUser => eachUser.following_user_id)
  return arrayOfIds
}

// AUTHENTICATION TOKEN
const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}
// TWEET ACCESS VERIFICATION
const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
    select 
    *
    from 
    tweet inner join follower
    on tweet.user_id = follower.following_user_id
    where  
    tweet.tweet_id = '${tweetId}' and follower_user_id = '${userId}'; `
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//API 1
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `select * from user where username= '${username}';`
  const dbUser = await db.get(getUserQuery)

  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassowrd = await bcrypt.hash(password, 10)
      const createUserQuery = `
      insert into 
      user(username, password, name, gender)
      values(
        '${username}',
        '${hashedPassowrd}',
        '${name}',
        '${gender}'
      )`
      await db.run(createUserQuery)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const postLoginQuery = ` select * from user where username = '${username}'`
  const dbUser = await db.get(postLoginQuery)
  if (dbUser !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password)
    if (isPasswordCorrect) {
      const payload = {username, userId: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

//API 3
app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username)
  const getQueryArray = `
          select 
          username,
          tweet,
          date_time as dateTime
          from 
          user
          inner Join tweet 
          on user.user_id = tweet.user_id
          where user.user_id in (${followingPeopleIds})
          order by date_time desc
          limit 4; `
  const queryArray = await db.all(getQueryArray)
  response.send(queryArray)
})

// API 4
app.get('/user/following/', authentication, async (request, response) => {
  const {username, userId} = request
  const getFollowerQuery = `
      select 
      name from 
      follower
      inner join user 
      on user.user_id = follower.following_user_id
      where follower_user_id = '${userId}';`
  const queryArray = await db.all(getFollowerQuery)
  response.send(queryArray)
})

//API 5

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request
  const getFollowerQueryList = ` 
    select
    distinct name from 
    follower inner join user
    on user.user_id = follower.follower_user_id
    where following_user_id = '${userId}';`
  const followerQuery = await db.all(getFollowerQueryList)
  response.send(followerQuery)
})

// API 6
app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `
  select tweet,
  (select count() from like where tweet_id= '${tweetId}') as likes,
  (select count() from reply where tweet_id= '${tweetId}') as replies,
  date_time as dateTime
  from tweet
  where 
  tweet.tweet_id = '${tweetId}';`
    const tweetArray = await db.get(getTweetQuery)
    response.send(tweetArray)
  },
)

//API 7
app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `
      select 
      username
      from 
      user inner join like 
      on user.user_id = like.user_id
      where 
      tweet_id = '${tweetId}';`
    const likeUsers = await db.all(getLikesQuery)
    const userArray = likeUsers.map(eachUser => eachUser.username)
    response.send({likes: userArray})
  },
)

//API 8
app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getReplyQuery = `
      select 
      name, reply
      from 
      user inner join reply 
      on user.user_id = reply.user_id
      where 
      tweet_id = '${tweetId}';`
    const replyArray = await db.all(getReplyQuery)
    response.send({replies: replyArray})
  },
)

//API 9
app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request
  const getTweetQuery = `
  select 
  tweet,
  count(distinct like_id) as likes,
  count(distinct reply_id) as replies,
  date_time as dateTime
  from
  tweet
  left join reply on
  tweet.tweet_id = reply.tweet_id left join like 
  on tweet.tweet_id = like.tweet_id
  where 
  tweet.user_id = ${userId}
  group by tweet.tweet_id;`
  const tweets = await db.all(getTweetQuery)
  response.send(tweets)
})

//API 10

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createTweetQuery = `
  insert into 
  tweet(tweet, user_id, date_time)
  values(
    '${tweet}', '${userId}', '${dateTime}'
  )
  `
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

//API 11
app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTweetQuery = `select * from tweet where user_id = '${userId}' and tweet_id = '${tweetId}';`
  const tweet = await db.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteQuery = `delete from tweet where tweet_id = '${tweetId}';`
    await db.run(deleteQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
