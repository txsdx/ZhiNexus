/** Decode WebDriver's HTTP envelope separately from values returned by application scripts. */
/** A successful execute-script result may itself contain an error field; only a failed protocol response is a driver error. */
export async function nativeDriverValue(response) {
  const data = await response.json();
  if (!response.ok) {
    const failure = data.value;
    throw Error(failure?.error + ": " + (failure?.message ?? response.status));
  }
  return data.value;
}
