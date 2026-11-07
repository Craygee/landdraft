import type { StudyReportSectionGuidance, StudyReportSectionId } from "./types.ts";

/**
 * Standing limits for each section. These are written so a report cannot be read as a professional
 * determination, whatever the mapped layers happen to show.
 */
export const STUDY_SECTION_GUIDANCE: Partial<
  Record<StudyReportSectionId, StudyReportSectionGuidance>
> = {
  "land-cover": {
    whyItMatters:
      "Existing use, ownership context and local land-use controls shape what can be built and what must be cleared or retained.",
    notEvaluated: [
      "Title, recorded boundaries, easement widths and legal access. Parcel lines are assessment records, not surveys.",
      "Zoning and entitlements outside the specific local sources shown here. Most places have no connected zoning source.",
      "Current site conditions. Land cover and imagery can be years old and do not resolve small features.",
    ],
    nextSteps: [
      "Order a survey and title commitment.",
      "Confirm zoning, overlays and permitted uses with the local planning office.",
      "Walk the site and compare it with current imagery.",
    ],
  },
  terrain: {
    whyItMatters:
      "Slope and relief drive grading cost, drainage, road layout and which parts of a site can hold a building pad.",
    notEvaluated: [
      "Survey-grade topography, cut and fill, pad fit or stormwater design.",
      "Features smaller than the elevation grid spacing, including ditches, berms and small steep breaks.",
      "Slope stability. Slope bands describe the surface and do not establish buildability.",
    ],
    nextSteps: [
      "Run Buildable Area to apply explicit slope rules to this boundary.",
      "Commission a topographic survey before design.",
      "Have a civil engineer review grading and drainage.",
    ],
  },
  hydrology: {
    whyItMatters:
      "Floodplains, wetlands, streams and groundwater can limit development area, require permits and determine whether on-site water is realistic.",
    notEvaluated: [
      "Jurisdictional wetland or waters determinations. NWI is an inventory, not a delineation.",
      "Flood elevations, map-revision effects or local floodplain rules. Unmapped areas are not shown to be free of flood risk.",
      "Water rights, well yield, water quality or whether a well would produce. Nearby wells and aquifer extents do not establish any of these.",
    ],
    nextSteps: [
      "Commission a wetland delineation where mapped wetlands or streams are on or near the site.",
      "Confirm the effective FIRM and requirements with the floodplain administrator.",
      "Contact the groundwater district or a hydrogeologist before relying on a well.",
    ],
  },
  soils: {
    whyItMatters:
      "Soil and geology affect foundations, septic feasibility, excavation cost and erosion control.",
    notEvaluated: [
      "Bearing capacity, shrink-swell behavior at a specific location, depth to rock and groundwater.",
      "Septic suitability. Map-unit names alone do not carry the related NRCS interpretations.",
      "Karst, subsidence or mine voids, unless a source for them appears in another section.",
    ],
    nextSteps: [
      "Run the Web Soil Survey interpretations for the exact boundary.",
      "Commission a geotechnical investigation before design.",
    ],
  },
  "site-suitability": {
    whyItMatters:
      "A saved Buildable Area result applies explicit, editable rules to its own boundary, so acreage can be traced to stated assumptions.",
    notEvaluated: [
      "Whether the land can legally or practically be built on. Buildable Area is a screening calculation under the rules you selected.",
      "Any constraint category that had no connected source when that analysis ran.",
    ],
    nextSteps: [
      "Run Buildable Area on this exact boundary if no saved result is shown.",
      "Have survey, title, environmental and engineering reviews confirm the result.",
    ],
  },
  environmental: {
    whyItMatters:
      "Regulated facilities, cleanup records, protected land and cultural resources can create liability, restrictions and longer permitting.",
    notEvaluated: [
      "Environmental clearance. This is not a Phase I Environmental Site Assessment, and point records do not show contamination extent.",
      "Unreported or unlisted conditions, and restricted archaeological locations.",
      "Whether a listed species is present. Critical habitat maps do not cover where species occur.",
    ],
    nextSteps: [
      "Commission a Phase I ESA before acquisition or financing.",
      "Request agency case files for any cleanup record on or near the site.",
      "Run a USFWS IPaC species list and consult the State Historic Preservation Office.",
    ],
  },
  infrastructure: {
    whyItMatters:
      "Road, rail, water, sewer and power proximity often decides feasibility and early capital cost.",
    notEvaluated: [
      "Legal access, curb-cut approval or road capacity. A mapped road near a boundary does not establish access.",
      "Easement or right-of-way widths, or any right to cross a neighbor.",
      "Utility capacity, service commitments or connection rights. Being near a line or inside a service area establishes none of these.",
    ],
    nextSteps: [
      "Confirm access and right-of-way from title and the road authority.",
      "Request will-serve letters from the water, sewer and electric providers.",
      "Call 811 before any digging. Public pipeline and utility maps are not locate-grade.",
    ],
  },
  energy: {
    whyItMatters:
      "Transmission, pipelines, generation and existing wells define both opportunity and physical constraints for energy-related uses.",
    notEvaluated: [
      "Interconnection capacity, queue position or available megawatts. Proximity to a line or substation establishes none of these.",
      "Pipeline commodity or status beyond what the publisher lists, and the location accuracy of any line.",
      "Mineral ownership, surface-use rights and wellbore paths.",
    ],
    nextSteps: [
      "Request a utility pre-application or interconnection study.",
      "Check the National Pipeline Mapping System and operator records.",
      "Review mineral title and well records for any well on or near the site.",
    ],
  },
  hazards: {
    whyItMatters: "Natural hazards affect design, insurance and long-term operating risk.",
    notEvaluated: [
      "Site-specific hazard. The National Risk Index reports census tracts, not parcels.",
      "Seismic design values, slope stability or landslide risk at this location. A location without inventory points is not shown to be stable.",
    ],
    nextSteps: [
      "Obtain design ground motions from a licensed engineer where they apply.",
      "Have a geotechnical engineer evaluate slopes near any mapped landslide.",
    ],
  },
};
