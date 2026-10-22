// Matchmaker settings for every game. Fill these in after creating the matchmaker in the Edgegap
// dashboard (Matchmaker > your matchmaker > API URL and Auth Token), or put them in
// client/config.local.js (git-ignored, same shape), or pass ?mm=<url>&token=<token> in the page URL.
//
// The Auth Token is the matchmaker's client token: it is made to ship in game clients and gives
// no access to your Edgegap account. Never put your Edgegap API token here.
export default {
  matchmakerUrl: "",
  matchmakerToken: "",
};
