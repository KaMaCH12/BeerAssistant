const {
  conversation,
  Card,
  Collection,
  CollectionBrowse,
  Simple,
  List,
  Media,
  Image,
  Table,
} = require("@assistant/conversation");
const functions = require("firebase-functions");
const { google } = require("googleapis");
const { OAuth2 } = google.auth;

const oAuth2Client = new OAuth2("<CLIENT_ID>", "<CLIENT_SECRET_KEY>");

oAuth2Client.setCredentials({
  refresh_token: "<REFRESH_TOKEN_FOR_ALL_AUTHORIZED_APIs>", // can be obtained by using OAuth playground - google developer's site
});

const app = conversation({ debug: true });

app.handle("ShowLocation", (conv) => {
  let location = conv.device.currentLocation;
  conv.add(
    `DEBUG: Your current latitude is ${location.coordinates.latitude} and your current longitude is ${location.coordinates.longitude}`
  );
});

var collection = {};

app.handle("ShowPubsInTheArea", async (conv) => {
  let location = conv.device.currentLocation;
  var lat = location.coordinates.latitude;
  var lng = location.coordinates.longitude;
  const API_KEY = "<PLACES_API_KEY>";
  var nearbyPlaces =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?keyword=piwo&location=" +
    lat +
    "," +
    lng +
    "&radius=1500&type=bar&key=" +
    API_KEY;
  const axios = require("axios");
  await axios.get(nearbyPlaces).then((response) => {
    collection.name = "prompt_option";
    collection.mode = "TYPE_REPLACE";
    collection.synonym = {
      entries: [],
    };
    var numOfEntriesFound = 0;
    for (var i = 0; i < response.data.results.length; i++) {
      if (i > 9) break;
      numOfEntriesFound++;
      var place = response.data.results[i];
      if (place.business_status != "OPERATIONAL") {
        continue;
      }
      var placePhoto;
      if (place.photos) {
        placePhoto =
          "https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=" +
          place.photos[0].photo_reference +
          "&key=" +
          API_KEY;
      } else {
        placePhoto = place.icon;
      }
      var entry = {
        name: "ITEM_" + (i + 1),
        synonyms: ["Item " + (i + 1)],
      };
      var item = {};
      item.image = new Image({
        url: placePhoto,
      });
      item.title = place.name;
      item.description = place.vicinity;
      entry.display = item;
      collection.synonym.entries.push(entry);
    }
    conv.session.typeOverrides = [collection];
    var entriesKeys = [];
    for (var l = 0; l < numOfEntriesFound; l++) {
      var entryKey = {};
      entryKey.key = "ITEM_" + (l + 1);
      entriesKeys.push(entryKey);
    }
    conv.add(
      new Collection({
        title: "Pubs in your area",
        items: entriesKeys,
      })
    );
  });
});

app.handle("PubIsChosenAskForConfirm", (conv) => {
  let choice = conv.session.params.promptChoice;
  var chosenEntry;
  for (var entry of collection.synonym.entries) {
    if (entry.name == choice) chosenEntry = entry.display;
  }
  conv.session.params.placeData = chosenEntry;
  conv.add("You've chosen " + chosenEntry.title);
  conv.add(
    new Card({
      title: chosenEntry.title,
      text: chosenEntry.description,
      image: chosenEntry.image,
    })
  );
});

function isIterable(value) {
  return Symbol.iterator in Object(value);
}

async function CreateCalendarEvent(conv, attendeesEmails) {
  var date = conv.session.params.timeDay;
  var hour = conv.session.params.timeHour;
  var placeData = conv.session.params.placeData;

  let attendeesObject = [];
  if (isIterable(attendeesEmails)) {
    for (let personEmail of attendeesEmails) {
      var attendee = {
        email: personEmail,
        responseStatus: "needsAction",
      };
      attendeesObject.push(attendee);
    }
  }

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const eventStartTime = new Date(
    date.year,
    date.month - 1,
    date.day,
    hour.hours,
    hour.minutes,
    0
  );

  let eventEndTime = null;
  if (hour.hours + 4 > 23) {
    eventEndTime = new Date(
      date.year,
      date.month - 1,
      date.day + 1,
      (parseInt(hour.hours) + 4) % 24,
      hour.minutes,
      0
    );
  } else {
    eventEndTime = new Date(
      date.year,
      date.month - 1,
      date.day,
      parseInt(hour.hours) + 4,
      hour.minutes,
      0
    );
  }

  const event = {
    summary: `Beer at ` + placeData.title,
    location: placeData.description,
    description: `Meeting in a Pub created by Beer Assistant`,
    colorId: 1,
    start: {
      dateTime: eventStartTime,
      timeZone: hour.time_zone.id,
    },
    end: {
      dateTime: eventEndTime,
      timeZone: hour.time_zone.id,
    },
    attendees: attendeesObject,
    maxAttendees: 100,
    visibility: "public",
  };
  await calendar.events.insert(
    { calendarId: "primary", sendUpdates: "all", resource: event },
    (err) => {
      if (err) return conv.add("Error Creating Calender Event: " + err);
      return conv.add("Calendar event successfully created.");
    }
  );
}

var attendees;

app.handle("SearchFriends", async (conv) => {
  attendees = [];
  conv.session.params.invitedFriends = [];
  let people = conv.session.params.attendees;
  conv.session.params.attendees = [];
  const peopleService = google.people({ version: "v1", auth: oAuth2Client });
  for (let person of people) {
    const res = await peopleService.people.searchContacts({
      query: person,
      pageSize: 10,
      readMask: "names,email_addresses",
    });
    for (let result of res.data.results) {
      try {
        attendees.push(result.person.emailAddresses[0].value);
        conv.session.params.invitedFriends.push(
          result.person.emailAddresses[0].value
        );
      } catch (exception) {}
    }
  }
});

app.handle("CreateEvent", async (conv) => {
  await CreateCalendarEvent(conv, attendees);
});

app.handle("ListInvitedFriends", (conv) => {
  let listOfInvitedFriendsString = "";
  for (let invitedFriend of conv.session.params.invitedFriends) {
    listOfInvitedFriendsString += invitedFriend;
    listOfInvitedFriendsString += ", ";
  }
  conv.add("I'll invite:");
  conv.add(listOfInvitedFriendsString);
});

exports.ActionsOnGoogleFulfillment = functions.https.onRequest(app);
