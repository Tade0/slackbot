var request = require('request'),
    express = require('express'),
    config  = require('./config.json'),
    cors    = require('cors'),
    Firebase = require('firebase'),
    bodyParser = require('body-parser'),
    app  = express(),
    users = {
      general: {
        name: '#general'
      }
    },
    ref = new Firebase(config.firebaseURL),
    slackRef = ref.child('slack'),
    lastDate;

app.use(cors());

app.use(bodyParser.json({extended: true}));

ref.authWithCustomToken( config.firebaseToken, function(error) {
  if (error) {
    console.log('Authentication Failed!', error);
  } else {
    console.log('Authenticated successfully');
  }

  updateUsers(function() {
    checkDueDates();
    setInterval(checkDueDates, 1000 * 60 * 60);
  });


  app.post('/notify', function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    slackRef.child(req.body.uid).once('value', function(snapshot) {

      console.log('Channel: ' + req.body.user + ', text:' + req.body.text);

      if (snapshot.val() == req.body.token && users[req.body.user]) {

        request.post({url:'https://slack.com/api/chat.postMessage', form: {
          token: config.slackToken,
          channel: req.body.user == 'general' ? '#general' : '@' + users[req.body.user].name,
          text: req.body.text
        }}, function(err, httpResponse, body){});

        res.end('ok');
      } else {
        if (!(snapshot.val() == req.body.token)) {
          res.end('invalid token');
          return;
        }
        if (!users[req.body.user]) {
          res.end('no such channel/user');
        }
      }
    });
  });
});

function updateUsers(callback) {
  request.post({
    url:'https://slack.com/api/users.list',
    form: {
      token: config.slackToken
    }
  }, function(err, httpResponse, body) {
    JSON.parse(body).members
      .forEach(user => {
        user.profile.email && (users['@' + user.profile.email.replace(/\+.*?@/, '@')] = user);
      });
    callback();
  });
}

function checkDueDates() {
  if ( lastDate == (new Date()).getDate() ) {
    return;
  }

  lastDate = (new Date()).getDate();

  ref.child('users').once('value', function(snapshot) {
    snapshot.forEach(function(snapshot) {

      var email = snapshot.val().google.email;

      snapshot.child('cards').forEach(function(card) {
        if (!card.child('dueDate').val() || !users['@' + email]) {
          return;
        }

        var cardData = card.val();

        var timeDifference = Math.floor((+new Date(card.child('dueDate').val()) - new Date()) / (1000 * 60 * 60 * 24));
        if (timeDifference > 0) {
          if ([7, 3, 1].indexOf(timeDifference) !== -1) {
            request.post({url:'https://slack.com/api/chat.postMessage', form: {
              token: config.slackToken,
              channel: '@' + users['@' + email].name,
              text: 'Your card: "' + cardData.type + '" is due in ' + timeDifference + ' day' + (timeDifference === 1 ? '.' : 's.')
            }});

            if ( config.unleasherChannel ) {
              request.post({url:'https://slack.com/api/chat.postMessage', form: {
                token: config.slackToken,
                channel: '@' + config.unleasherChannel,
                text: users['@' + email].name + '\'s card: "' + cardData.type + '" is due in ' + timeDifference + ' day' + (timeDifference === 1 ? '.' : 's.')
              }});
            }
          }
        } else {
          if (timeDifference == 0) {
            request.post({url:'https://slack.com/api/chat.postMessage', form: {
              token: config.slackToken,
              channel: '@' + users['@' + email].name,
              text: 'Your card: "' + cardData.type + '" is overdue!'
            }});

            if ( config.unleasherChannel ) {
              request.post({url:'https://slack.com/api/chat.postMessage', form: {
                token: config.slackToken,
                channel: '@' + config.unleasherChannel,
                text: users['@' + email].name + '\'s card: "' + cardData.type + '" is overdue!'
              }});
            }
          }
        }
      });
    });
  });
}

app.listen(8081);
