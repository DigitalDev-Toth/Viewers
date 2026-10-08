export default displaySet => {
  // Optional all the way down: plenty of mammography in the wild has no
  // ViewCodeSequence, and throwing here takes the whole protocol down with it.
  const ViewCodeSequence = displaySet?.images?.[0]?.ViewCodeSequence?.[0];
  if (!ViewCodeSequence) {
    return undefined;
  }
  const { CodingSchemeDesignator, CodeValue } = ViewCodeSequence;
  if (!CodingSchemeDesignator || !CodeValue) {
    return undefined;
  }
  return `${CodingSchemeDesignator}:${CodeValue}`;
};
