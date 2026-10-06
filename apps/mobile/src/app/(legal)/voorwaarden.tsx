import { Redirect } from "expo-router";

/**
 * The NL terms are published at `/voorwaarden` and the disclaimer links there. The canonical
 * text lives at `/terms`; this alias exists so that link never dies.
 */
export default function VoorwaardenAlias() {
  return <Redirect href={{ pathname: "/terms", params: { lang: "nl" } }} />;
}
